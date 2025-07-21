#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Script to update hooks for projects that don't have them
 * Usage: node update-hooks-script.js --config config.json --dry-run
 */

class HookUpdater {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://app.fossa.com';
    this.apiToken = config.apiToken;
    this.csrfToken = config.csrfToken;
    this.hookConfig = config.hookConfig || {
      type: 'github',
      active: true,
      secret_key: this.generateSecretKey()
    };
    this.batchSize = config.batchSize || 10;
    this.delayMs = config.delayMs || 1000;
    this.dryRun = false;
  }

  generateSecretKey(size = 32) {
    // Generate cryptographically secure secret key using Node.js crypto
    // Matches FOSSA's server-side generation: crypto.randomBytes(size).toString('base64url')
    return crypto.randomBytes(size).toString('base64url');
  }

  async makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FOSSA-Hook-Updater/1.0.0',
          'x-requested-with': 'XMLHttpRequest'
        }
      };

      // Add authentication headers
      if (this.apiToken) {
        options.headers['Authorization'] = `Bearer ${this.apiToken}`;
      }

      // Add CSRF token if provided
      if (this.csrfToken) {
        options.headers['csrf-token'] = this.csrfToken;
      }

      const req = httpModule.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const result = responseData ? JSON.parse(responseData) : {};
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: result
            });
          } catch (e) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              data: responseData
            });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  async getProjectsWithoutHooks(locators = null) {
    console.log('🔍 Identifying projects without hooks...');
    
    // If specific locators provided, check those
    if (locators && locators.length > 0) {
      const projectsWithoutHooks = [];
      
      for (const locator of locators) {
        try {
          const encodedLocator = encodeURIComponent(locator);
          const response = await this.makeRequest('GET', `/api/projects/${encodedLocator}`);
          
          if (response.statusCode === 200) {
            const project = response.data;
            const hasActiveHook = project.updateHook && project.updateHook.active;
            
            if (!hasActiveHook) {
              projectsWithoutHooks.push({
                locator: locator,
                encodedLocator: encodedLocator,
                currentHook: project.updateHook || null
              });
              console.log(`  ❌ ${locator} - No active hook`);
            } else {
              console.log(`  ✅ ${locator} - Already has active hook (${project.updateHook.type})`);
            }
          } else {
            console.error(`  ⚠️  ${locator} - Failed to fetch project (status: ${response.statusCode})`);
          }
          
          // Rate limiting
          await this.sleep(this.delayMs);
        } catch (error) {
          console.error(`  ❌ ${locator} - Error: ${error.message}`);
        }
      }
      
      return projectsWithoutHooks;
    }
    
    // TODO: If no specific locators, could implement pagination to get all projects
    // This would require additional API endpoints for listing projects
    console.log('⚠️  No specific locators provided. Please provide an array of project locators to check.');
    return [];
  }

  async updateProjectHook(project) {
    const { locator, encodedLocator } = project;
    
    if (this.dryRun) {
      console.log(`  🧪 DRY RUN: Would update hook for ${locator}`);
      return { success: true, dryRun: true };
    }

    try {
      const updateData = {
        updateHook: {
          ...this.hookConfig,
          secret_key: this.hookConfig.secret_key || this.generateSecretKey()
        }
      };

      console.log(`  📡 Updating hook for ${locator}...`);
      
      const response = await this.makeRequest('PUT', `/api/projects/${encodedLocator}`, updateData);
      
      if (response.statusCode >= 200 && response.statusCode < 300) {
        console.log(`  ✅ Successfully updated hook for ${locator}`);
        return { 
          success: true, 
          locator: locator,
          hookType: this.hookConfig.type,
          secretKey: updateData.updateHook.secret_key
        };
      } else {
        console.error(`  ❌ Failed to update hook for ${locator} (status: ${response.statusCode})`);
        console.error(`     Response: ${JSON.stringify(response.data)}`);
        return { 
          success: false, 
          locator: locator, 
          error: `HTTP ${response.statusCode}`,
          response: response.data
        };
      }
    } catch (error) {
      console.error(`  ❌ Error updating hook for ${locator}: ${error.message}`);
      return { 
        success: false, 
        locator: locator, 
        error: error.message 
      };
    }
  }

  async updateHooksInBatches(projects) {
    console.log(`🔄 Updating hooks for ${projects.length} projects (batch size: ${this.batchSize})...`);
    
    const results = {
      successful: [],
      failed: [],
      total: projects.length
    };

    for (let i = 0; i < projects.length; i += this.batchSize) {
      const batch = projects.slice(i, i + this.batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(projects.length / this.batchSize)} (${batch.length} projects):`);

      const batchPromises = batch.map(project => this.updateProjectHook(project));
      const batchResults = await Promise.all(batchPromises);

      batchResults.forEach(result => {
        if (result.success) {
          results.successful.push(result);
        } else {
          results.failed.push(result);
        }
      });

      // Rate limiting between batches
      if (i + this.batchSize < projects.length) {
        console.log(`  ⏳ Waiting ${this.delayMs}ms before next batch...`);
        await this.sleep(this.delayMs);
      }
    }

    return results;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run(locators, options = {}) {
    this.dryRun = options.dryRun || false;
    
    console.log('🚀 Starting Hook Update Script');
    console.log(`   Base URL: ${this.baseUrl}`);
    console.log(`   Hook Type: ${this.hookConfig.type}`);
    console.log(`   Batch Size: ${this.batchSize}`);
    console.log(`   Delay: ${this.delayMs}ms`);
    console.log(`   Dry Run: ${this.dryRun}`);
    console.log('');

    try {
      // Step 1: Find projects without hooks
      const projectsWithoutHooks = await this.getProjectsWithoutHooks(locators);
      
      if (projectsWithoutHooks.length === 0) {
        console.log('🎉 All specified projects already have active hooks!');
        return;
      }

      console.log(`\n📊 Found ${projectsWithoutHooks.length} projects without active hooks:`);
      projectsWithoutHooks.forEach(p => console.log(`   - ${p.locator}`));

      // Step 2: Update hooks in batches
      const results = await this.updateHooksInBatches(projectsWithoutHooks);

      // Step 3: Report results
      console.log('\n📈 SUMMARY REPORT');
      console.log('='.repeat(50));
      console.log(`Total Projects: ${results.total}`);
      console.log(`✅ Successful: ${results.successful.length}`);
      console.log(`❌ Failed: ${results.failed.length}`);

      if (results.successful.length > 0) {
        console.log('\n✅ SUCCESSFUL UPDATES:');
        results.successful.forEach(r => {
          if (r.dryRun) {
            console.log(`   - ${r.locator} (DRY RUN)`);
          } else {
            console.log(`   - ${r.locator} (${r.hookType})`);
          }
        });
      }

      if (results.failed.length > 0) {
        console.log('\n❌ FAILED UPDATES:');
        results.failed.forEach(r => {
          console.log(`   - ${r.locator}: ${r.error}`);
        });
      }

      // Save detailed results to file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const resultsFile = `hook-update-results-${timestamp}.json`;
      fs.writeFileSync(resultsFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        config: {
          baseUrl: this.baseUrl,
          hookType: this.hookConfig.type,
          batchSize: this.batchSize,
          delayMs: this.delayMs,
          dryRun: this.dryRun
        },
        results: results
      }, null, 2));
      
      console.log(`\n💾 Detailed results saved to: ${resultsFile}`);

    } catch (error) {
      console.error('\n💥 Script failed with error:', error.message);
      throw error;
    }
  }
}

// CLI Interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const configFile = args.find(arg => arg.startsWith('--config=')).split('=')[1];
  const dryRun = args.includes('--dry-run');
  const locatorsFile = args.find(arg => arg.startsWith('--locators=')).split('=')[1];

  if (!configFile) {
    console.error('❌ Usage: node update-hooks-script.js --config=config.json [--locators=locators.json] [--dry-run]');
    console.error('');
    console.error('Example config.json:');
    console.error(JSON.stringify({
      "baseUrl": "https://app.fossa.com",
      "apiToken": "your-api-token-here", 
      "csrfToken": "your-csrf-token-here",
      "hookConfig": {
        "type": "github",
        "active": true,
        "secret_key": "kXkma8RPU9G12e3MdGXJoKu9Pz6N6aTmERwTq7oEQZo"
      },
      "batchSize": 10,
      "delayMs": 1000
    }, null, 2));
    console.error('');
    console.error('Example locators.json:');
    console.error(JSON.stringify([
      "git+github.com/org/repo1",
      "git+github.com/org/repo2"
    ], null, 2));
    process.exit(1);
  }

  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    let locators = null;
    
    if (locatorsFile) {
      locators = JSON.parse(fs.readFileSync(locatorsFile, 'utf8'));
    }

    const updater = new HookUpdater(config);
    updater.run(locators, { dryRun }).catch(error => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
  } catch (error) {
    console.error('❌ Error reading config file:', error.message);
    process.exit(1);
  }
}

module.exports = HookUpdater;
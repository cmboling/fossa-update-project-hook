# FOSSA Hook Updater Script

A Node.js script to bulk update GitHub hooks for FOSSA projects that don't have active hooks configured.

## Features

- ✅ Identifies projects without active hooks
- ✅ Bulk updates hooks with configurable batch processing
- ✅ Dry run mode for safe testing
- ✅ Comprehensive logging and error handling
- ✅ Generates detailed results report
- ✅ Supports custom hook configurations

## Prerequisites

- Node.js (version 12+)
- Valid FOSSA API access
- CSRF token (obtained from browser session)

## Usage

### 1. Basic Usage

```bash
node update-hooks-script.js --config=config.json --locators=locators.json
```

### 2. Dry Run (Recommended First)

```bash
node update-hooks-script.js --config=config.json --locators=locators.json --dry-run
```

## Configuration

### config.json

```json
{
  "baseUrl": "https://app.fossa.com",
  "apiToken": "your-api-token-here",
  "csrfToken": "your-csrf-token-here",
  "hookConfig": {
    "type": "github",
    "active": true,
    "secret_key": "your-webhook-secret-key"
  },
  "batchSize": 5,
  "delayMs": 2000
}
```

**Configuration Options:**
- `baseUrl`: FOSSA instance URL
- `apiToken`: Your FOSSA API token
- `csrfToken`: CSRF token from browser session
- `hookConfig`: Hook configuration object
  - `type`: Hook type (`github`, `gitlab`, `bitbucket_cloud`, etc.)
  - `active`: Whether the hook should be active
  - `secret_key`: Webhook secret key (auto-generated if not provided)
- `batchSize`: Number of projects to process simultaneously
- `delayMs`: Delay between batches (milliseconds)

### locators.json

```json
[
  "git+github.com/org/repo1",
  "git+github.com/org/repo2",
  "npm+package-name"
]
```

## Getting CSRF Token

1. Open FOSSA web app in browser
2. Navigate to any project settings page
3. Open browser developer tools → Network tab
4. Make any API request (e.g., refresh page)
5. Look for `csrf-token` header in the request

## Supported Hook Types

- `github` - GitHub webhooks
- `gitlab` - GitLab webhooks  
- `bitbucket_cloud` - Bitbucket Cloud webhooks
- `scheduled` - Scheduled updates
- `webhook` - Generic webhooks
- `azure_repos` - Azure Repos webhooks

## Output

The script provides:

1. **Real-time console output** with progress indicators
2. **Summary report** with success/failure counts
3. **Detailed JSON results file** with timestamp

### Example Output

```
🚀 Starting Hook Update Script
   Base URL: https://app.fossa.com
   Hook Type: github
   Batch Size: 5
   Delay: 2000ms
   Dry Run: false

🔍 Identifying projects without hooks...
  ❌ git+github.com/org/repo1 - No active hook
  ✅ git+github.com/org/repo2 - Already has active hook (github)

📦 Processing batch 1/1 (1 projects):
  📡 Updating hook for git+github.com/org/repo1...
  ✅ Successfully updated hook for git+github.com/org/repo1

📈 SUMMARY REPORT
==================================================
Total Projects: 1
✅ Successful: 1
❌ Failed: 0

💾 Detailed results saved to: hook-update-results-2024-01-15T10-30-00-000Z.json
```

## Safety Features

- **Dry run mode**: Test without making changes
- **Batch processing**: Prevents API overwhelming
- **Rate limiting**: Configurable delays between requests
- **Error handling**: Continues processing even if individual projects fail
- **Detailed logging**: Track exactly what happened

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check API token and CSRF token
2. **403 Forbidden**: Verify permissions for target projects
3. **429 Too Many Requests**: Increase `delayMs` in config
4. **Invalid locator format**: Ensure locators follow pattern `fetcher+package$revision`

### Getting Help

1. Run with `--dry-run` first to test configuration
2. Check the generated results JSON file for detailed error information
3. Verify API tokens are current and have required permissions
4. Test with a single project locator first

## Example Workflow

```bash
# 1. Create configuration
cp example-config.json my-config.json
# Edit my-config.json with your tokens

# 2. Create locators list  
cp example-locators.json my-locators.json
# Edit my-locators.json with your project locators

# 3. Test with dry run
node update-hooks-script.js --config=my-config.json --locators=my-locators.json --dry-run

# 4. Run for real
node update-hooks-script.js --config=my-config.json --locators=my-locators.json
```

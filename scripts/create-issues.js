const fs = require('fs');
const path = require('path');

// Ensure token exists and is valid
const token = process.env.GITHUB_TOKEN;
if (!token || token === 'github_pat_antigravitydummytoken') {
  console.error('\x1b[31m%s\x1b[0m', '❌ Error: GITHUB_TOKEN is not set or is set to a dummy token.');
  console.error('\x1b[33m%s\x1b[0m', 'Please run the script by setting your own GitHub Personal Access Token (PAT) first:');
  console.error('\x1b[36m%s\x1b[0m', 'Windows (PowerShell):');
  console.error('  $env:GITHUB_TOKEN="your_personal_access_token"');
  console.error('  node scripts/create-issues.js');
  console.error('\x1b[36m%s\x1b[0m', 'macOS / Linux:');
  console.error('  GITHUB_TOKEN="your_personal_access_token" node scripts/create-issues.js');
  process.exit(1);
}

const issuesPath = path.join(__dirname, 'issue-data.json');
if (!fs.existsSync(issuesPath)) {
  console.error('\x1b[31m%s\x1b[0m', '❌ Error: issue-data.json not found in scripts directory.');
  process.exit(1);
}

const issues = JSON.parse(fs.readFileSync(issuesPath, 'utf8'));
const repo = 'SatyamPandey-07/WorkSphere';

console.log('\x1b[35m%s\x1b[0m', `🚀 Starting creation of ${issues.length} feature issues in repository ${repo}...`);

async function createIssue(issue) {
  const url = `https://api.github.com/repos/${repo}/issues`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application.vnd.github.v3+json',
      'User-Agent': 'WorkSphere-Issue-Creator'
    },
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.html_url;
}

async function run() {
  let successCount = 0;
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    console.log(`[${i + 1}/${issues.length}] Creating: "${issue.title}"...`);
    try {
      const issueUrl = await createIssue(issue);
      console.log('\x1b[32m%s\x1b[0m', `   ✅ Successfully created: ${issueUrl}`);
      successCount++;
      // Sleep for a short time to avoid hitting secondary rate limits
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      console.error('\x1b[31m%s\x1b[0m', `   ❌ Failed to create issue: ${err.message}`);
    }
  }

  console.log('\x1b[35m%s\x1b[0m', '\n=============================================');
  console.log('\x1b[32m%s\x1b[0m', `🎉 Process finished. Created ${successCount}/${issues.length} issues successfully.`);
  console.log('\x1b[35m%s\x1b[0m', '=============================================');
}

run();

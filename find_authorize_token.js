const https = require('https');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const url = 'https://elearning.skypec.com.vn/main.2dc26528cac32998a30c.bundle.js';
    const content = await getUrl(url);

    console.log('--- SEARCHING CASE-INSENSITIVELY FOR "authoriz" ---');
    const regex = /authoriz[a-zA-Z0-9_]*/gi;
    let match;
    let count = 0;
    while ((match = regex.exec(content)) !== null) {
      count++;
      if (count > 20) {
        console.log('Too many matches, stopping...');
        break;
      }
      console.log(`\nMatch ${count} at index ${match.index}:`);
      console.log(content.substring(match.index - 100, match.index + 200));
    }

  } catch (e) {
    console.error(e);
  }
}

main();

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
    const content = await getUrl('https://elearning.skypec.com.vn/1.9cff440471c3912db573.chunk.js');

    console.log('--- SEARCHING FOR feGetUdemyClass CALLS ---');
    let idx = 0;
    while (true) {
      idx = content.indexOf('feGetUdemyClass', idx);
      if (idx === -1) break;
      console.log(`\nMatch at index ${idx}:`);
      console.log(content.substring(idx - 100, idx + 400));
      idx += 15;
    }

  } catch (e) {
    console.error(e);
  }
}

main();

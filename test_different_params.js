const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const HOST = 'elearning.skypec.com.vn';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'd6F3EFEa15839011290abcdef1234567';

function decrypt(text) {
  try {
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return text;
  }
}

function loginSkypec(username, password) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      grant_type: 'password', client_id: 'web', username: username, password: password, scope: ''
    });
    const options = {
      hostname: HOST, port: 443, path: '/skypec2.authentication.api/connect/token', method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function fetchApi(token, path, method = 'GET', postData = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443, path: path, method: method,
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://elearning.skypec.com.vn',
        'Referer': 'https://elearning.skypec.com.vn/lop-hoc'
      }
    };
    const req = https.request(options, (res) => {
      console.log(`[Response Header] Status for ${path}: ${res.statusCode}`);
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function main() {
  try {
    const dbPath = path.join(__dirname, 'database.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    
    const acc = await db.get('SELECT * FROM accounts WHERE username = ?', '199805002');
    const password = decrypt(acc.password);
    const loginRes = await loginSkypec('199805002', password);
    const token = loginRes.access_token;
    
    const variations = [
      '/skypec2.lms.api/api/v1/LmsUdemyClass/FEGetUdemyClass?offset=0&limit=10&keyword=&cateId=00000000-0000-0000-0000-000000000000&isAll=true',
      '/skypec2.lms.api/api/v1/LmsUdemyClass/FEGetUdemyClass?offset=0&limit=10&keyword=&cateId=2d9b0a8c-6ef4-42cd-ab11-2b5e388cc22f&isAll=true',
      '/skypec2.lms.api/api/v1/LmsUdemyClass/FEGetUdemyClass?offset=0&limit=10&keyword=&cateId=2d9b0a8c-6ef4-42cd-ab11-2b5e388cc22f&isAll=false',
      '/skypec2.lms.api/api/v1/LmsUdemyClass/FEGetUdemyClass?offset=0&limit=10&keyword=&isAll=true',
      '/skypec2.lms.api/api/v1/LmsUdemyClass/FEGetUdemyClass?offset=0&limit=10&isAll=true'
    ];

    for (const url of variations) {
      console.log(`\n--- CALLING: ${url} ---`);
      const res = await fetchApi(token, url, 'GET');
      console.log(JSON.stringify(res).substring(0, 1000));
    }

  } catch (e) {
    console.error(e);
  }
}

main();

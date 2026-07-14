const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const CONFIG = {
  api_key: 'c66289394c2a6e8515c8e8b382fba719',
  offer_id: '14985',
  user_id: '75329',
  api_domain: 'https://t-api.org',
};

function checkSum(jsonData) {
  return crypto.createHash('sha1').update(jsonData + CONFIG.api_key).digest('hex');
}

function makeRequest(data, model, method) {
  return new Promise((resolve, reject) => {
    const payload = {
      user_id: CONFIG.user_id,
      data: data,
    };

    const jsonData = JSON.stringify(payload);
    const checkSumValue = checkSum(jsonData);

    const apiUrl = new URL(
      `${CONFIG.api_domain}/api/${model}/${method}?check_sum=${encodeURIComponent(checkSumValue)}`
    );

    const options = {
      hostname: apiUrl.hostname,
      port: apiUrl.port || 443,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData),
      },
    };

    const protocol = apiUrl.protocol === 'https:' ? https : http;

    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({
          http_code: res.statusCode,
          result: body,
          error: '',
          errno: 0,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        http_code: 0,
        result: '',
        error: err.message,
        errno: 1,
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      resolve({
        http_code: 0,
        result: '',
        error: 'Request timeout',
        errno: 1,
      });
    });

    req.write(jsonData);
    req.end();
  });
}

function getData(response) {
  if (response.http_code === 200 && response.errno === 0) {
    let body;
    try {
      body = JSON.parse(response.result);
    } catch (e) {
      throw new Error('JSON response error');
    }

    if (body.status === 'ok') {
      return body.data;
    } else if (body.status === 'error') {
      throw new Error(body.error);
    } else {
      throw new Error('Unknown response status');
    }
  } else {
    if (response.result) {
      let body;
      try {
        body = JSON.parse(response.result);
      } catch (e) {
        throw new Error('JSON response error');
      }
      if (body.status === 'error') {
        throw new Error(body.error);
      } else {
        throw new Error('Unknown response status');
      }
    } else {
      throw new Error('HTTP request error. ' + response.error);
    }
  }
}

function getClientIp(headers) {
  if (headers['cf-connecting-ip']) return headers['cf-connecting-ip'];
  if (headers['x-real-ip']) return headers['x-real-ip'];
  if (headers['x-forwarded-for']) return headers['x-forwarded-for'].split(',')[0].trim();
  return '0.0.0.0';
}

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    // Vercel automatically parses the body into req.body
    const post = req.body || {};
    const query = req.query || {};

    if (!post.name || !post.phone) {
      const referer = req.headers.referer || '/';
      return res.writeHead(302, { Location: referer }).end();
    }

    const ip = getClientIp(req.headers);

    const leadData = {
      name: (post.name || '').trim(),
      phone: (post.phone || '').trim(),
      offer_id: CONFIG.offer_id,
      country: 'HU',
    };

    // Optional params from form body
    const optionalFields = [
      'region', 'city', 'count', 'tz', 'address', 'email', 'zip',
      'user_comment', 'stream_id',
    ];
    for (const field of optionalFields) {
      if (post[field]) leadData[field] = post[field];
    }

    // UTM params from query string
    const utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    for (const field of utmFields) {
      if (query[field]) leadData[field] = query[field];
    }

    // Sub IDs from query string
    const subFields = ['sub_id', 'sub_id_1', 'sub_id_2', 'sub_id_3', 'sub_id_4'];
    for (const field of subFields) {
      if (query[field]) leadData[field] = query[field];
    }

    // Referer, user agent, IP
    leadData.referer = query.referer || req.headers.referer || '';
    leadData.user_agent = req.headers['user-agent'] || 'Unknown';
    leadData.ip = ip;

    const response = await makeRequest(leadData, 'lead', 'create');
    const lead = getData(response);

    if (lead) {
      const redirectUrl = `/success.html?id=${lead.id}`;
      return res.writeHead(302, { Location: redirectUrl }).end();
    } else {
      return res.status(500).send('Failed to create lead');
    }
  } catch (err) {
    return res.status(500).send(err.message);
  }
};

const Url = require("url");
const ftp = require("basic-ftp");
const { http, https } = require("follow-redirects");

// The Node url.parse returns an object where the protocol is lower case and contains the colon at the end
const SECURE_FTP_PROTOCOL = "sftp:";
const FTP_PROTOCOL = "ftp:";
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";

/**
 * TODO: Change to array of URLs to parse
 * Always returns 200. Body is true if file URL is valid, body is false if file URL is not valid or something has gone wrong
 * The request is expected to have a url query parameter (i.e. ?url=https://www.google.ca)
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
exports.lambdaHandler = async function (event) {
  const url = event.queryStringParameters.url;
  return checkUrl(url);
};

async function checkUrl(url) {
  return run(url)
    .then(() => {
      return returnResponse(true);
    })
    .catch((error) => {
      console.error(`Something went wrong`, { error });
      return returnResponse(false);
    });
}

async function run(url) {
  const parsedUrl = Url.parse(url);
  const protocol = parsedUrl.protocol; // Url.parse() lower cases the protocol
  if (FTP_PROTOCOL === protocol || SECURE_FTP_PROTOCOL === protocol) {
    const secure = SECURE_FTP_PROTOCOL === protocol;
    const ftpClient = new ftp.Client();
    try {
      let options = {
        host: parsedUrl.host,
        secure: secure,
      };
      if (parsedUrl.port) {
        options = { port: parsedUrl.port, ...options };
      }
      await ftpClient.access(options);
      const size = await ftpClient.size(parsedUrl.path);
      return size > 0
        ? Promise.resolve()
        : Promise.reject("Could not get size for " + url);
    } finally {
      ftpClient.close();
    }
  } else if (HTTP_PROTOCOL === protocol) {
    return httpOrHttpsRequest(url, http);
  } else if (HTTPS_PROTOCOL === protocol) {
    return httpOrHttpsRequest(url, https);
  }
  return Promise.reject("Unsupported protocol: " + protocol);
}

function httpOrHttpsRequest(url, httpOrHttps) {
  return new Promise((resolve, reject) => {
    const req = httpOrHttps.request(url, {
      method: "HEAD",
      headers: { "user-agent": "Dockstore/1.0" }, // User-agent must be set for tests to pass, AWS (WAF?) blocks requests with no user-agent
    });
    req.on("response", (res) => {
      if (res.statusCode < 300) {
        resolve(res.statusCode);
      }
      reject(res.statusCode);
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

function returnResponse(fileFound) {
  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: fileFound,
    }),
  };
  return response;
}

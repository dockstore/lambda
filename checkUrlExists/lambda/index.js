const fs = require("fs");
const tls = require("tls");
const process = require("process");

const { curly } = require("node-libcurl");

// important steps to get validation of https (as opposed to http) urls
// Get root certificates so https will work
//
// Write the certificates to a file
// https://stackoverflow.com/questions/63052127/protractor-node-libcurl-failed-ssl-peer-certificate-or-ssh-remote-key-was-not-o
// When doing sam build the file must be in /tmp because other wise it cannot be read
// due to ro file system in container
// https://stackoverflow.com/questions/53810516/getting-error-aws-lambda-erofs-read-only-file-system-open-var-task-assets
const certFilePath = "/tmp/cacert.pem";
// https://nodejs.org/api/tls.html#tls_tls_rootcertificates
// An immutable array of strings representing the root certificates (in PEM format) from the bundled Mozilla CA store as supplied by current Node.js version.
// The bundled CA store, as supplied by Node.js, is a snapshot of Mozilla CA store that is fixed at release time. It is identical on all supported platforms.
const tlsData = tls.rootCertificates.join("\n");
fs.writeFileSync(certFilePath, tlsData);

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
  console.log(process.env.PATH);
  console.log(process.env.LD_LIBRARY_PATH);
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
  const curlOpts = {
    caInfo: certFilePath,
  };
  return curly.head(url, curlOpts);
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

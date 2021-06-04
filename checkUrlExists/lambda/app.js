const fetch = require("node-fetch");
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

function checkUrl(url) {
  return fetch(url, { method: "HEAD" })
    .then((res) => {
      if (res.ok) {
        return returnResponse(true);
      } else {
        return returnResponse(false);
      }
    })
    .catch(() => {
      return returnResponse(false);
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

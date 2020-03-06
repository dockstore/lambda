'use strict';

const AWS = require('aws-sdk');
const url = require('url');
const https = require('https');
const crypto = require('crypto');
const qs = require('querystring');

// Verification function to check if it is actually GitHub who is POSTing here
const verifyGitHub = (req) => {
  if (!req['user-agent'].includes('GitHub-Hookshot')) {
      return false;
  }
  // Compare their hmac signature to our hmac signature
  // (hmac = hash-based message authentication code)
  const theirSignature = req['X-Hub-Signature'];
  
  // Need to decode base64 encoded payload
  var buff = new Buffer(req.payload, 'base64');
  const payload = buff.toString('ascii');
  const secret = process.env.SECRET_TOKEN; 
  const ourSignature = `sha1=${crypto.createHmac('sha1', secret).update(payload).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(theirSignature), Buffer.from(ourSignature));
};

// Makes a POST request to the given path
function callEndpoint(path, postBody, callback) {
    console.log('POST ' + path);
    console.log(qs.stringify(postBody));
    
    const options = url.parse(path);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Bearer ' + process.env.DOCKSTORE_TOKEN
    };

    const req = https.request(options, (res) => {
        var chunks = [];
        var bodyString = '';
        
        res.on("data", function (chunk) {
            chunks.push(chunk);
            bodyString += chunk.toString()
        });

       res.on('end', function() {
           if (callback) {
               // If content-type is text/plain, the body contains the message, else the message is found in the JSON object
               var contentType = res.headers['content-type'];
               var responseMessage = contentType.includes('text/plain') ? bodyString : res.statusMessage;
               callback({
                   statusCode: res.statusCode,
                   statusMessage: responseMessage
               });
           }
       });
       return res;
    });
    req.write(qs.stringify(postBody));
    req.end();
}

// Performs an action based on the event type (action)
function processEvent(event, callback) {
    // Usually returns array of records, however it is fixed to only return 1 record
    console.log(JSON.stringify(event));
    var loneEvent = event.Records[0];
    var requestBody = JSON.parse(loneEvent.body);
    if (! verifyGitHub(requestBody)) {
        console.log('GitHub could not be verified');
        callback(null, {"statusCode": 403, "body": "something is wrong, github secret does not match"});
        return;
    } else {
        console.log('GitHub is verified');
    }
    
    // The payload is encoded in base64
    var buff = new Buffer(requestBody.payload, 'base64');
    const body = JSON.parse(buff.toString('ascii'));

    console.log('GitHub Payload');
    console.log(JSON.stringify(body));
    
    var path = process.env.API_URL;

    // A push has been made for some repository
    const repository = body.repository.full_name;
    const username = body.sender.login;
    const gitReference = body.ref;
    const installationId = body.installation.id;
    
    var pushPostBody = {
            "gitReference": gitReference,
            "installationId": installationId,
            "repository": repository,
            "username": username
        };

    path += "workflows/github/release";
    
    callEndpoint(path, pushPostBody, (response) => {
        console.log(response);
        if (response.statusCode < 400) {
            console.info('The associated entries on Dockstore for repository ' + repository + ' with version ' + gitReference + ' have been updated');
            callback(null);
        } else if (response.statusCode < 500) {
            // Client error, don't retry
            console.error(`Error handling GitHub webhook, will not retry: ${response.statusCode} - ${response.statusMessage}`);
            callback(null);
        } else {
            // Server error, retry
            console.info('Server error, retrying call');
            callback({ "statusCode": response.statusCode, "statusMessage": response.statusMessage });
        }
    }); 
    
    callback(null, {"statusCode": 200, "body": "results"});
}


exports.handler = (event, context, callback) => {
    processEvent(event, callback);
};

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
               console.log(res.headers);
               console.log(res.headers['content-type']);
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
    console.log(event);
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
    console.log(body);
    
    const action = body.action;
    
    if (action != null) {
        console.log('action is ' + action);
        var path = process.env.API_URL;
        if (action === 'added') {
            if ('repositories_added' in body) {
                // App has been installed on n repositories
                const username = body.installation.account.login;
                const installationId = body.installation.id;
                path += "workflows/path/service";
                
                // If one of the calls fail, will retry all calls
                for (var i = 0; i < body.repositories_added.length; i++) {
                    var addPostBody = {
                       "username": username,
                       "installationId": installationId,
                       "repository": body.repositories_added[i].full_name
                    };
                    callEndpoint(path, addPostBody, (response) => {
                        console.log(response);
                        if (response.statusCode < 400) {
                            console.info('Service added successfully');
                        } else if (response.statusCode < 500) {
                            // Client error, don't retry
                            console.error(`Error updating workflow: ${response.statusCode} - ${response.statusMessage}`);
                        } else {
                            // Server error, retry
                            console.info('Retrying call');
                            callback({ "statusCode": response.statusCode, "statusMessage": response.statusMessage });
                        }
                    });   
                }
            }
            
        } else if (action === 'created') {
            if ('release' in body) {
                // A release has been created for some repository
                const repository = body.repository.full_name;
                const username = body.sender.login;
                const gitReference = body.release.tag_name;
                const installationId = body.installation.id;
                
                var releasePostBody = {
                       "gitReference": gitReference,
                       "installationId": installationId,
                       "repository": repository,
                       "username": username
                    };
                path += "workflows/path/service/upsertVersion";
                callEndpoint(path, releasePostBody, (response) => {
                    console.log(response);
                    if (response.statusCode < 400) {
                        console.info('Service ' + repository + ' updated successfully');
                        callback(null);
                    } else if (response.statusCode < 500) {
                        // Client error, don't retry
                        console.error(`Error updating workflow: ${response.statusCode} - ${response.statusMessage}`);
                        callback(null);
                    } else {
                        // Server error, retry
                        console.info('Retrying call');
                        callback({ "statusCode": response.statusCode, "statusMessage": response.statusMessage });
                    }
                });   
            }
        }
    }
    
    callback(null, {"statusCode": 200, "body": "results"});
}


exports.handler = (event, context, callback) => {
    processEvent(event, callback);
};

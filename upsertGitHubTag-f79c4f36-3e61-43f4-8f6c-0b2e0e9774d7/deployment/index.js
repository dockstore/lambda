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
    console.log('Calling the path ' + path);
    console.log(qs.stringify(postBody))
    const options = url.parse(path);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Bearer ' + process.env.DOCKSTORE_TOKEN
    };

    const req = https.request(options, (res) => {
        var chunks = [];
        
        res.on("data", function (chunk) {
            chunks.push(chunk);
        });

       res.on('end', function() {
           if (callback) {
               callback({
                   statusCode: res.statusCode,
                   statusMessage: res.statusMessage
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
    }
    
    // The payload is encoded in base64
    var buff = new Buffer(requestBody.payload, 'base64');
    const body = JSON.parse(buff.toString('ascii'));

    console.log('past encoding');
    console.log(body);
    
    const action = body.action;
    console.log('action determined');
    console.log(action);
    
    if (action != null) {
        var path = "https://staging.dockstore.org/api/";
        if (action === 'added') {
            if ('repositories_added' in body) {
                // App has been installed on n repositories
                const username = body.installation.account.login;
                const installationId = body.installation.id;
                
                for (var i = 0; i < body.repositories_added.length; i++) {
                    var postBody = {
                       "username": username,
                       "installationId": installationId,
                       "repository": body.repositories_added[i].full_name
                    };
                    path += "workflows/path/service";
                    console.log("sending postbody with");
                    console.log(postBody);
                    callEndpoint(path, postBody, (response) => {
                        if (response.statusCode < 400) {
                            console.info('Service added successfully');
                        } else if (response.statusCode < 500) {
                            console.error(`Error updating workflow: ${response.statusCode} - ${response.statusMessage}`);
                        } else {
                            // Let Lambda retry
                            console.info('Retrying call');
                            callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
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
                
                var postBody = {
                       "gitReference": gitReference,
                       "installationId": installationId,
                       "repository": repository,
                       "username": username
                    };
                path += "workflows/path/service/upsertVersion";
                callEndpoint(path, postBody, (response) => {
                    if (response.statusCode < 400) {
                        console.info('Service ' + repository + ' updated successfully');
                        callback(null);
                    } else if (response.statusCode < 500) {
                        console.error(`Error updating workflow: ${response.statusCode} - ${response.statusMessage}`);
                        callback(null);
                    } else {
                        // Let Lambda retry
                        console.info('Retrying call');
                        callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
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

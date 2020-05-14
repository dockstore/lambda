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
function postEndpoint(path, postBody, callback) {
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

// Makes a DELETE request to the given path
function deleteEndpoint(path, repository, reference, username, installationId, callback) {
    console.log('DELETE ' + path);

    path += '?gitReference=' + reference + "&repository=" + repository + "&username=" + username + "&installationId=" + installationId;
    
    const options = url.parse(path);
    options.method = 'DELETE';
    options.headers = {
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
    });
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

    // Handle installation events
    var githupEventType = event.headers["X-GitHub-Event"]
    if (githubEventType === "installation_repositories") {
        console.log('Valid installation event');
        const username = body.sender.login;
        const installationId = body.installation.id;
        const repositoriesAdded = body.repositories_added;
        var repositories = [];
        repositoriesAdded.forEach((repo) => {
            repositories.push(repo.full_name);
        });

        var pushPostBody = {
            "installationId": installationId,
            "username": username,
            "repositories": repositories.join(",")
        };
        path += "workflows/github/install";
            
        postEndpoint(path, pushPostBody, (response) => {
            const successMessage = 'The GitHub app was successfully installed on repository ' + repository;
            handleCallback(response, successMessage, callback);
        });
    } else if (githubEventType === "push") {
        /**
         * We only handle push events, of which there are many subtypes. Unfortunately, the only way to differentiate between them is to look
         * for expected fields. There are no enums for push events subtypes.
         * 
         * If an event is deemed not supported, we will return a success and print a message saying the event is not supported.
         */
        if (['repository', 'ref', 'created', 'deleted', 'pusher'].some(str => !(str in body))) {
            console.log('Event is not supported')
            callback(null, {"statusCode": 200, "body": "Currently, this lambda does not support this event type from GitHub."});
        }

        // A push has been made for some repository (ignore pushes that are deletes)
        if (!body.deleted) {
            console.log('Valid push event');
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
            
            postEndpoint(path, pushPostBody, (response) => {
                const successMessage = 'The associated entries on Dockstore for repository ' + repository + ' with version ' + gitReference + ' have been updated';
                handleCallback(response, successMessage, callback);
            });
        } else {
            console.log('Valid push event (delete)');
            const repository = body.repository.full_name;
            const gitReference = body.ref;
            const username = body.sender.login;
            const installationId = body.installation.id;

            path += "workflows/github";
            
            deleteEndpoint(path, repository, gitReference, username, installationId, (response) => {
                const successMessage = 'The associated versions on Dockstore for repository ' + repository + ' with version ' + gitReference + ' have been deleted';
                handleCallback(response, successMessage, callback);
            });
        }
    } else {
        console.log('Event ' + githupEventType + ' is not supported')
        callback(null, {"statusCode": 200, "body": "Currently, this lambda does not support the event type" + githupEventType + " from GitHub."});
    }
    
    callback(null, {"statusCode": 200, "body": "results"});
}

// Handle response from Dockstore webservice
function handleCallback(response, successMessage, callback) {
    console.log(response);
    if (response.statusCode < 400) {
        console.info(successMessage);
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
}


exports.handler = (event, context, callback) => {
    processEvent(event, callback);
};

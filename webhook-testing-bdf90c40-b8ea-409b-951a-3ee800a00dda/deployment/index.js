'use strict';

/**
 * Follow these steps to configure the webhook in Slack:
 *
 *   1. Navigate to https://<your-team-domain>.slack.com/services/new
 *
 *   2. Search for and select "Incoming WebHooks".
 *
 *   3. Choose the default channel where messages will be sent and click "Add Incoming WebHooks Integration".
 *
 *   4. Copy the webhook URL from the setup instructions and use it in the next section.
 *
 *
 * To encrypt your secrets use the following steps:
 *
 *  1. Create or use an existing KMS Key - http://docs.aws.amazon.com/kms/latest/developerguide/create-keys.html
 *
 *  2. Click the "Enable Encryption Helpers" checkbox
 *
 *  3. Paste <SLACK_HOOK_URL> into the kmsEncryptedHookUrl environment variable and click encrypt
 *
 *  Note: You must exclude the protocol from the URL (e.g. "hooks.slack.com/services/abc123").
 *
 *  4. Give your function's role permission for the kms:Decrypt action.
 *      Example:

{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "Stmt1443036478000",
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": [
                "<your KMS key ARN>"
            ]
        }
    ]
}

 */

const AWS = require('aws-sdk');
const url = require('url');
const https = require('https');
const crypto = require('crypto');

// Verification function to check if it is actually GitHub who is POSTing here
const verifyGitHub = (req) => {
    console.log(req);
  if (!req.headers['User-Agent'].includes('GitHub-Hookshot')) {
      return false;
  }
  // Compare their hmac signature to our hmac signature
  // (hmac = hash-based message authentication code)
  const theirSignature = req.headers['X-Hub-Signature'];
  const payload = req.body;
  console.log(payload);
  const secret = process.env.SECRET_TOKEN; 
  const ourSignature = `sha1=${crypto.createHmac('sha1', secret).update(payload).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(theirSignature), Buffer.from(ourSignature));
};


// The base-64 encoded, encrypted key (CiphertextBlob) stored in the kmsEncryptedHookUrl environment variable
const kmsEncryptedHookUrl = process.env.kmsEncryptedHookUrl;
// The Slack channel to send a message to stored in the slackChannel environment variable
const slackChannel = process.env.slackChannel;
let hookUrl;


function postMessage(message, callback) {
    const body = JSON.stringify(message);
    const options = url.parse(hookUrl);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    const postReq = https.request(options, (res) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
            if (callback) {
                callback({
                    body: chunks.join(''),
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                });
            }
        });
        return res;
    });

    postReq.write(body);
    postReq.end();
}

function processEvent(event, callback) {
    if (! verifyGitHub(event)) {
        callback(null, {"statusCode": 403, "body": "something is wrong, github secret does not match"})
        return;
    }

    const body = JSON.parse(event.body);

    const repository = body.repository.full_name;
    const refType = body.ref_type;
    const ref = body.ref;
    
    if (typeof ref === 'undefined') {
        callback(null, {"statusCode": 204, "body": "this is not an event type we handle"})
        return;
    }

    const slackMessage = {
        channel: slackChannel,
        text: `${repository} created a new ${refType} called ${ref}`,
    };

    postMessage(slackMessage, (response) => {
        if (response.statusCode < 400) {
            console.info('Message posted successfully');
            callback(null);
        } else if (response.statusCode < 500) {
            console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
            callback(null);  // Don't retry because the error is due to a problem with the request
        } else {
            // Let Lambda retry
            callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
        }
    });
    
    callback(null, {"statusCode": 200, "body": "results"})
}


exports.handler = (event, context, callback) => {
    if (hookUrl) {
        // Container reuse, simply process the event with the key in memory
        processEvent(event, callback);
    } else if (kmsEncryptedHookUrl && kmsEncryptedHookUrl !== '<kmsEncryptedHookUrl>') {
        const encryptedBuf = new Buffer(kmsEncryptedHookUrl, 'base64');
        const cipherText = { CiphertextBlob: encryptedBuf };

        const kms = new AWS.KMS();
        kms.decrypt(cipherText, (err, data) => {
            if (err) {
                console.log('Decrypt error:', err);
                return callback(err);
            }
            hookUrl = `https://${data.Plaintext.toString('ascii')}`;
            processEvent(event, callback);
        });
    } else {
        callback('Hook URL has not been set.');
    }
};

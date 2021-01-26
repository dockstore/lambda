'use strict';

/**
 * Follow these steps to configure the webhook in Slack:
 *
 *   1. Navigate to https://<your-team-domain>.slack.com/services/new
 *
 *   2. To send a message to an existing webhook select "Manage" then
 *      "Custom Integrations" then "Incoming WebHooks" then edit the configuration.
 *      To create a new webhook click "Add to Slack"
 *
 *   4. Copy the webhook URL from the setup instructions (e.g. "https://hooks.slack.com/services/abc123").
 *
 *   5. On the Lambda console window click Edit the environment variable section and environment
 *      variable "slackChannel" and add for the value the channel name, e.g. "#dockstore-dev-testing".
 *      Add the environment variable "hookUrl" and for the value use the webhook URL
 *
 */

const url = require('url');
const https = require('https');
var AWS = require("aws-sdk");

// The Slack URL to send the message to
const hookUrl = process.env.hookUrl;
// The Slack channel to send a message to stored in the slackChannel environment variable
const slackChannel = process.env.slackChannel;
const dockstoreEnvironment = process.env.dockstoreEnvironment;

// Enumerate all the AWS instances in the current region
// and find the one with the instance ID in question.
// Then go through all the tags on that instance and
// find the one with the key 'Name', whose value
// is the name displayed on the console of the instance,
// and return that name.
function getInstanceName(myInstanceId, callback) {
  var ec2 = new AWS.EC2();
  var instanceName = 'unknown';

  ec2.describeInstances(function(err, result) {
    if (err)
      console.log(err); // Logs error message.
    for (var i = 0; i < result.Reservations.length; i++) {
      var res = result.Reservations[i];
      var instances = res.Instances;
      for (var j = 0; j < instances.length; j++) {
        var instanceID = instances[j].InstanceId;
        if ( instanceID === myInstanceId ) {
          var tags = instances[j].Tags;
          for (var k = 0; k < tags.length; k++) {
            if (tags[k].Key == 'Name') {
              instanceName = tags[k].Value;
              return callback(instanceName);
            }
          }
          return callback(instancename);
        }
      }
    }
    return callback(instanceName)
 });
}

function foundInstanceName(instanceName) {
  return instanceName;
}

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
    console.log(event);
    const message = JSON.parse(event.Records[0].Sns.Message);

    let messageText;

    if (message.source == 'aws.config') {
        const alarmName = message.detail.configRuleName;
        const newState = message.detail.newEvaluationResult.complianceType;
        messageText = `${alarmName} state is now ${newState}`;
    } else if (message.source == 'aws.ssm') {
        const eventName = message.detail.eventName;
        const userName = message.detail.userIdentity.userName;
        const sourceIPAddress = message.detail.sourceIPAddress;
        messageText = `${userName} initiated AWS Systems Manager (SSM) event ${eventName} from IP ${sourceIPAddress}`;
        if (message.detail.hasOwnProperty("requestParameters") && message.detail['requestParameters']) {
          if (message.detail.requestParameters.hasOwnProperty("target")) {
            const targetInstance = message.detail.requestParameters.target;
            const targetInstanceName = getInstanceName(targetInstance, foundInstanceName);
            messageText = messageText + ` to target: ${targetInstanceName} (${targetInstance})`;
          }
        }
        if (message.detail.hasOwnProperty("errorCode") && message.detail['errorCode']) {
          const errorCode = message.detail.errorCode;
          messageText = messageText + ` but received error code: ${errorCode}`;
        }
        //if (message.detail.hasOwnProperty("errorMessage") && message.detail['errorMessage']) {
        //  const errorMessage = message.detail.errorMessage;
        //  messageText = messageText + ` with error message: ${errorMessage}`;
        //}
        messageText = messageText + ` on Dockstore ` + dockstoreEnvironment + ` in region: ` + message.region;
    } else {
        const alarmName = message.AlarmName;
        const newState = message.NewStateValue;
        const reason = message.NewStateReason;
        messageText = `${alarmName} state is now ${newState}: ${reason}`;
    }

    const slackMessage = {
        channel: slackChannel,
        text: messageText,
    };

    postMessage(slackMessage, (response) => {
        if (response.statusCode < 400) {
            console.info('Message posted successfully on Slack');
            callback(null);
        } else if (response.statusCode < 500) {
            console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
            callback(null);  // Don't retry because the error is due to a problem with the request
        } else {
            // Let Lambda retry
            callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
        }
    });
}


exports.handler = (event, context, callback) => {
    // This will record the event in the CloudWatch logs
    console.info("cloud-watch-to-slack-testing EVENT\n" + JSON.stringify(event, null, 2));
    if (hookUrl) {
        processEvent(event, callback);
    } else {
        callback('Hook URL has not been set.');
    }
};



"use strict";

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

const url = require("url");
const https = require("https");
const AWS = require("aws-sdk");

// The Slack URL to send the message to
const hookUrl = process.env.hookUrl;
// The Slack channel to send a message to stored in the slackChannel environment variable
const slackChannel = process.env.slackChannel;
const dockstoreEnvironment = process.env.dockstoreEnvironment;

// Enumerate all the AWS instances in the current region
// and find the one with the instance ID in question.
// Then go through all the tags on that instance and
// find the one with the key 'Name', whose value
// is the name displayed on the console of the instance.
function getInstanceNameAndSendMsgToSlack(
  targetInstanceId,
  messageText,
  processEventCallback,
  callback
) {
  const ec2 = new AWS.EC2();

  ec2.describeInstances(function (err, result) {
    if (err) console.log(err);
    // Log the error message.
    else {
      for (var i = 0; i < result.Reservations.length; i++) {
        var res = result.Reservations[i];
        var instances = res.Instances;

        // Try to get the user friendly name of the EC2 target instance
        var instance = instances.find(
          (instance) => instance.InstanceId === targetInstanceId
        );
        var tagInstanceNameKey =
          instance && instance.Tags.find((tag) => "Name" === tag.Key);
        if (tagInstanceNameKey) {
          var tagInstanceName = tagInstanceNameKey.Value || "unknown";
          return callback(
            messageText,
            tagInstanceName,
            targetInstanceId,
            processEventCallback
          );
        }
      }
    }
    // If there was an error or the user friendly name was not found just send the
    // message to Slack with a default name for the target
    return callback(
      messageText,
      "unknown",
      targetInstanceId,
      processEventCallback
    );
  });
}

function constructMsgAndSendToSlack(
  messageText,
  targetInstanceName,
  targetInstanceId,
  callback
) {
  console.info(`Found instance name:${targetInstanceName}`);
  messageText =
    messageText + ` to target: ${targetInstanceName} (${targetInstanceId})`;

  sendMessageToSlack(messageText, callback);
}

function postMessage(message, callback) {
  const body = JSON.stringify(message);
  const options = url.parse(hookUrl);
  options.method = "POST";
  options.headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  };

  const postReq = https.request(options, (res) => {
    const chunks = [];
    res.setEncoding("utf8");
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      if (callback) {
        callback({
          body: chunks.join(""),
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

function sendMessageToSlack(messageText, callback) {
  const slackMessage = {
    channel: slackChannel,
    text: messageText,
  };

  postMessage(slackMessage, (response) => {
    if (response.statusCode < 400) {
      console.info("Message posted successfully on Slack");
      callback(null);
    } else if (response.statusCode < 500) {
      console.error(
        `Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`
      );
      callback(null); // Don't retry because the error is due to a problem with the request
    } else {
      // Let Lambda retry
      callback(
        `Server error when processing message: ${response.statusCode} - ${response.statusMessage}`
      );
    }
  });
}

function processEvent(event, callback) {
  console.log(event);
  const message = JSON.parse(event.Records[0].Sns.Message);

  let messageText;

  if (message.source == "aws.config") {
    const alarmName = message.detail.configRuleName;
    const newState = message.detail.newEvaluationResult.complianceType;
    messageText = `${alarmName} state is now ${newState}`;
    sendMessageToSlack(messageText, callback);
  } else if (message.source == "aws.guardduty") {
    messageText =
      `A GuardDuty Finding was reported on Dockstore ` +
      dockstoreEnvironment +
      ` in region: ` +
      message.region +
      `.`;
    messageText =
      messageText + ` The description is: ` + message.detail.description;
    sendMessageToSlack(messageText, callback);
  } else if (message.source == "aws.ssm" || message.source == "aws.signin") {
    const eventName = message.detail.eventName;
    const sourceIPAddress = message.detail.sourceIPAddress;

    messageText = `uninitialized message text`;
    if (message.source == "aws.ssm") {
      const userName = message.detail.userIdentity.userName;
      messageText = `${userName} initiated AWS Systems Manager (SSM) event ${eventName}`;
    } else if (message.source == "aws.signin") {
      const userType = message.detail.userIdentity.type;
      messageText = `A user initiated AWS sign-in event ${eventName} as ${userType}`;
    }

    if (
      Object.prototype.hasOwnProperty.call(message.detail, "errorCode") &&
      message.detail["errorCode"]
    ) {
      const errorCode = message.detail.errorCode;
      messageText = messageText + ` but received error code: ${errorCode}`;
    }

    messageText =
      messageText +
      ` on Dockstore ` +
      dockstoreEnvironment +
      ` in region: ` +
      message.region +
      `.`;
    messageText =
      messageText + ` Event was initiated from IP ${sourceIPAddress}`;

    if (
      Object.prototype.hasOwnProperty.call(
        message.detail,
        "requestParameters"
      ) &&
      message.detail["requestParameters"] &&
      Object.prototype.hasOwnProperty.call(
        message.detail.requestParameters,
        "target"
      )
    ) {
      const targetInstanceId = message.detail.requestParameters.target;
      getInstanceNameAndSendMsgToSlack(
        targetInstanceId,
        messageText,
        callback,
        constructMsgAndSendToSlack
      );
    } else {
      sendMessageToSlack(messageText, callback);
    }
  } else {
    const alarmName = message.AlarmName;
    const newState = message.NewStateValue;
    const reason = message.NewStateReason;
    messageText = `${alarmName} state is now ${newState}: ${reason}`;
    sendMessageToSlack(messageText, callback);
  }
}

exports.handler = (event, context, callback) => {
  // This will record the event in the CloudWatch logs
  console.info(
    "cloud-watch-to-slack-testing EVENT\n" + JSON.stringify(event, null, 2)
  );
  if (hookUrl) {
    processEvent(event, callback);
  } else {
    callback("Hook URL has not been set.");
  }
};

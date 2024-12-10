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
const { EC2Client, DescribeInstancesCommand } = require("@aws-sdk/client-ec2");

// The Slack URL to send the message to
const hookUrl = process.env.hookUrl;
// The Slack channel to send a message to stored in the slackChannel environment variable
const defaultSlackChannel = process.env.slackChannel;
const dockstoreEnvironment = process.env.dockstoreEnvironment;
const snsTopicToSlackChannel = JSON.parse(process.env.snsTopicToSlackChannel);

// Enumerate all the AWS instances in the current region
// and find the one with the instance ID in question.
// Then go through all the tags on that instance and
// find the one with the key 'Name', whose value
// is the name displayed on the console of the instance.
function getInstanceNameAndSendMsgToSlack(
  slackChannel,
  targetInstanceId,
  messageText,
  processEventCallback,
  callback
) {
  instanceName(targetInstanceId).then((friendlyName) => {
    callback(
      slackChannel,
      messageText,
      friendlyName,
      targetInstanceId,
      processEventCallback
    );
  });
}

/**
 * If the instanceId exists and has a tag whose key is "Name", returns that tag's value, otherwise returns null.
 * @param instanceId
 * @returns {Promise<void>}
 */
async function instanceName(instanceId) {
  const client = new EC2Client();
  const command = new DescribeInstancesCommand({
    InstanceIds: [instanceId],
  });
  try {
    const result = await client.send(command); // Throws if the instance is not found
    const instance = result.Reservations[0].Instances; // Safe to assume, as previous line would have thrown
    const tagInstanceNameKey = instance.Tags.find((tag) => "Name" === tag.Key);
    return tagInstanceNameKey?.Value || null;
  } catch (e) {
    console.error("Error describing instance", e);
  }
  return null;
}

function constructMsgAndSendToSlack(
  slackChannel,
  messageText,
  targetInstanceName,
  targetInstanceId,
  callback
) {
  console.info(`Found instance name:${targetInstanceName}`);
  if (targetInstanceName) {
    messageText =
      messageText + ` to target: ${targetInstanceName} (${targetInstanceId})`;
  } else {
    messageText = messageText + ` to target: ${targetInstanceId}`;
  }

  sendMessageToSlack(slackChannel, messageText, callback);
}

function postMessage(message, callback) {
  const body = JSON.stringify(message);
  console.info("body is:" + body);
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

function sendMessageToSlack(slackChannel, messageText, callback) {
  const slackMessage = {
    channel: slackChannel,
    text: messageText,
    username: `Dockstore ${dockstoreEnvironment} Notification`,
    icon_emoji: ":exclamation:",
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

function awsConfigMessageText(message) {
  const alarmName = message.detail.configRuleName;
  const newState = message.detail.newEvaluationResult.complianceType;
  // If the event has a resource in the details, include that in the message
  const resource = message.detail.resourceId
    ? `for ${message.detail.resourceId}`
    : "";
  return `${alarmName} state is now ${newState} ${resource}`;
}

function trustedAdvisorMessageText(message) {
  const detailType = message["detail-type"];
  const msgStatus = message.detail["status"];
  const checkName = message.detail["check-name"];
  const checkItemDetails = JSON.stringify(
    message.detail["check-item-detail"],
    null,
    2
  );
  return `${detailType} with status ${msgStatus} for Dockstore ${dockstoreEnvironment} in region ${message.region} for check ${checkName}. Details are:\n${checkItemDetails}`;
}

function guardDutyMessageText(message) {
  let messageText =
    `A GuardDuty Finding was reported on Dockstore ` +
    dockstoreEnvironment +
    ` in region: ` +
    message.region +
    `.`;
  return messageText + ` The description is: ` + message.detail.description;
}

function ssmOrSigninMessageText(message) {
  const eventName = message.detail.eventName;
  const sourceIPAddress = message.detail.sourceIPAddress;

  let messageText = `uninitialized message text`;
  if (message.source === "aws.ssm") {
    let user;
    if (message.detail.userIdentity.type === "IAMUser") {
      user = message.detail.userIdentity.userName;
    } else if (message.detail.userIdentity.type === "AssumedRole") {
      const accountId = message.detail.userIdentity.accountId;
      // Don't display account ID
      user = message.detail.userIdentity.arn.replace(
        accountId,
        "X".repeat(accountId.length)
      );
    }
    messageText = `${user} initiated AWS Systems Manager (SSM) event ${eventName}`;
  } else if (message.source === "aws.signin") {
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
  return messageText + ` Event was initiated from IP ${sourceIPAddress}`;
}

function cloudWatchEventBridgeAlarmMessageText(message) {
  const alarmName = message.detail.alarmName;
  const newState = message.detail.state.value;
  const newStateReason = message.detail.state.reason;
  return `${alarmName} state is now ${newState}: ${newStateReason}`;
}

function alarmMessageText(message) {
  const alarmName = message.AlarmName;
  const newState = message.NewStateValue;
  const reason = message.NewStateReason;
  return `${alarmName} state is now ${newState}: ${reason}`;
}

function dockstoreDeployerMessageText(message) {
  return message.message;
}

// https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
// https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/CloudWatchEventsandEventPatterns.html
function s3ActivityMessageText(message) {
  const userName = message.detail.userIdentity["userName"];
  const eventName = message.detail["eventName"];
  const awsRegion = message.detail["awsRegion"];
  const bucketName = message.detail.requestParameters["bucketName"];
  return `${userName} generated S3 event ${eventName} from region ${awsRegion} for bucket ${bucketName} in Dockstore ${dockstoreEnvironment}`;
}

function ecsActivityMessageText(message) {
  if (message["detail-type"] === "ECS Task State Change") {
    return ecsTaskStateChangeMessageText(message);
  } else {
    return ecsAutoScalingMessageText(message);
  }
}

function ecsTaskStateChangeMessageText(message) {
  const taskArn = message?.detail?.taskArn;
  const lastStatus = message?.detail?.lastStatus;
  let messageText = `Task ${taskArn} is now ${lastStatus}`;
  const taskContainers = message?.detail?.containers
    ?.map((container) => container.name)
    .join(", ");
  messageText += `\nContainers: ${taskContainers}`;
  ["startedAt", "stoppedAt", "stoppedReason"].forEach((name) => {
    const value = message?.detail?.[name];
    if (value != undefined) {
      messageText += `\n${name}: ${value}`;
    }
  });
  return messageText;
}

function ecsAutoScalingMessageText(message) {
  const serviceName = message.detail.requestParameters.service;
  const newDesiredCount = message.detail.requestParameters.desiredCount;
  const currentRunningCount =
    message.detail.responseElements.service.runningCount;
  return `Auto scaling event triggered for ECS service ${serviceName}. Desired count of tasks updated from ${currentRunningCount} to ${newDesiredCount}`;
}

function messageTextFromMessageObject(message) {
  if (message.source === "aws.config") {
    return awsConfigMessageText(message);
  } else if (message.source === "aws.trustedadvisor") {
    return trustedAdvisorMessageText(message);
  } else if (message.source === "aws.guardduty") {
    return guardDutyMessageText(message);
  } else if (message.source === "aws.ssm" || message.source === "aws.signin") {
    return ssmOrSigninMessageText(message);
  } else if (message.source === "aws.s3") {
    return s3ActivityMessageText(message);
  } else if (message.source === "dockstore.deployer") {
    return dockstoreDeployerMessageText(message);
  } else if (message.source === "aws.ecs") {
    return ecsActivityMessageText(message);
  } else if (message.source === "aws.cloudwatch") {
    return cloudWatchEventBridgeAlarmMessageText(message);
  } else {
    return alarmMessageText(message);
  }
}

function addInstanceDetails(message) {
  if (message.source === "aws.ssm" || message.source === "aws.signin") {
    return (
      Object.prototype.hasOwnProperty.call(
        message.detail,
        "requestParameters"
      ) &&
      message.detail["requestParameters"] &&
      Object.prototype.hasOwnProperty.call(
        message.detail.requestParameters,
        "target"
      )
    );
  }
  return false;
}

// Set the Slack channel based on the input SNS Topic to Slack Channel map
// in the snsTopicToSlackChannel env var with format
// {"<SNS Topic resource id>":"<slack channel name>"}
// E.g.
//     {"slack-low-priority-topic":"dockstore-testing",
//     "slack-medium-priority-topic":"dockstore-dev-alerts",
//     "slack-high-priority-topic":"dockstore-alerts",
//     "SSM-to-Slack-SNSTopicToSlack-1VI4KZW1DSADS":"dockstore-dev-testing" }
// input: SNS topic ARN
function setSlackChannelBasedOnSNSTopic(topicArn) {
  // Get the SNS Topic resource ID from the AWS ARN
  // https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html
  const snsTopicResourceID = topicArn.slice(topicArn.lastIndexOf(":") + 1);

  if (Object.keys(snsTopicToSlackChannel).includes(snsTopicResourceID)) {
    return snsTopicToSlackChannel[snsTopicResourceID];
  } else {
    return defaultSlackChannel;
  }
}

function processEvent(event, callback) {
  console.log(event);
  let message;
  let messageText;
  try {
    message = JSON.parse(event.Records[0].Sns.Message);
    messageText = messageTextFromMessageObject(message);
  } catch (e) {
    message = event.Records[0].Sns.Message;
    messageText = message;
    console.log("Plain message received: " + messageText);
  }
  const topicArn = event.Records[0].Sns.TopicArn;
  const slackChannel = setSlackChannelBasedOnSNSTopic(topicArn);
  console.info("Slack channel is " + slackChannel);

  if (addInstanceDetails(message)) {
    const targetInstanceId = message.detail.requestParameters.target;
    getInstanceNameAndSendMsgToSlack(
      slackChannel,
      targetInstanceId,
      messageText,
      callback,
      constructMsgAndSendToSlack
    );
  } else {
    sendMessageToSlack(slackChannel, messageText, callback);
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

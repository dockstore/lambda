import io
import json
import tempfile

from pygit2 import clone_repository
import sbpack.pack as pack
import ruamel.yaml


def lambda_handler(event, context):
    """Sample pure Lambda function

    Parameters
    ----------
    event: dict, required
        API Gateway Lambda Proxy Input Format

        Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format

    context: object, required
        Lambda Context runtime methods and attributes

        Context doc: https://docs.aws.amazon.com/lambda/latest/dg/python-context-object.html

    Returns
    ------
    API Gateway Lambda Proxy Output Format: dict

        Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
    """

    # try:
    #     ip = requests.get("http://checkip.amazonaws.com/")
    # except requests.RequestException as e:
    #     # Send some context about this error to Lambda Logs
    #     print(e)

    #     raise e

    # So, so many TODOs. Handle errors, use interface types
    body = json.loads(event['body'])
    git_url = body["git_url"]
    absolute_git_descriptor_path = body["descriptor_path"]
    # git_url = 'https://github.com/common-workflow-language/common-workflow-language.git'
    # absolute_git_descriptor_path = '/v1.0/examples/1st-workflow.cwl'
    with tempfile.TemporaryDirectory() as tempDir:
        clone_repository(git_url, tempDir)
        packed_cwl = pack.pack(tempDir + absolute_git_descriptor_path)
        yaml = ruamel.yaml.YAML()
        buf = io.BytesIO()
        yaml.dump(packed_cwl, buf)
        content = buf.getvalue().decode("utf-8")
        return {
            "statusCode": 200,
            "body": json.dumps({
                "content": content
            }),
        }

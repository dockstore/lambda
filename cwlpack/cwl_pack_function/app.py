"""app module."""
import io
import json
import tempfile

from pygit2 import clone_repository
from sbpack import pack
import ruamel.yaml

# Handles when the lambda is called
def lambda_handler(event, context):
    """Sample pure Lambda function

    Parameters
    ----------
    event: dict, required
        API Gateway Lambda Proxy Input Format

    context: object, required
        Lambda Context runtime methods and attributes

        Context doc: https://docs.aws.amazon.com/lambda/latest/dg/python-context-object.html

    Returns
    ------
    API Gateway Lambda Proxy Output Format: dict
    """

    # try:
    #     ip = requests.get("http://checkip.amazonaws.com/")
    # except requests.RequestException as e:
    #     # Send some context about this error to Lambda Logs
    #     print(e)

    #     raise e

    # So, so many TODOs. Handle errors, use interface types
    print(context)
    body = event['queryStringParameters']
    try:
        git_url = body["git_url"]
        absolute_git_descriptor_path = body["descriptor_path"]
    except KeyError:
        return {
            "statusCode": 400,
            "body": "Missing either git_url or descriptor_path"
        }
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            clone_repository(git_url, temp_dir)
            packed_cwl = pack.pack(temp_dir + absolute_git_descriptor_path)
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
        except FileNotFoundError:
            return {
                "statusCode": 400,
                "body": "Descriptor file not found in Git repository",
            }
        # An invalid CWL descriptor may cause sbpack to SystemExit
        except SystemExit:
            return {
                "statusCode": 400,
                "body": "Descriptor is invalid"
            }

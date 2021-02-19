import json
import os
import pytest
from inventory.mappers import LambdaDataMapper


@pytest.fixture()
def full_lambda_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_lambda.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)


def test_given_resource_type_is_not_lambda_then_empty_array_is_returned(full_lambda_config):
    full_lambda_config["resourceType"] = "NOT Lambda"

    mapper = LambdaDataMapper()

    assert mapper.map(full_lambda_config) == []

    full_lambda_config["resourceType"] = "AWS::Lambda::Function"
    assert len(mapper.map(full_lambda_config)) > 0, "Resource should have been mapped"


def test_given_lambda_version_contains_sha(full_lambda_config):
    mapper = LambdaDataMapper()

    assert full_lambda_config["configuration"]['codeSha256'] in mapper.map(full_lambda_config)[0].software_product_name


def test_given_resource_is_mapped_to_unique_id(full_lambda_config):
    mapper = LambdaDataMapper()

    assert mapper.map(full_lambda_config)[0].unique_id == "arn:aws:lambda:us-west-2:123456789:function:InventoryCollector"

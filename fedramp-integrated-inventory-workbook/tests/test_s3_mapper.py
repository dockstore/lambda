import json
import os
import pytest
from inventory.mappers import S3DataMapper

@pytest.fixture()
def full_s3_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_s3.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)

def test_given_resource_type_is_not_s3_then_empty_array_is_returned(full_s3_config):
    full_s3_config["resourceType"] = "NOT S3"

    mapper = S3DataMapper()

    assert mapper.map(full_s3_config) == []

    full_s3_config["resourceType"] = "AWS::S3::Bucket"
    assert len(mapper.map(full_s3_config)) > 0, "Resource should have been mapped"

def test_given_resource_type_is_private_when_all_public_access_blocked(full_s3_config):
    mapper = S3DataMapper()

    mapped_result = mapper.map(full_s3_config)
    assert mapped_result[0].is_public == "No", "Bucket has no public access enabled"

    full_s3_config["supplementaryConfiguration"]["PublicAccessBlockConfiguration"]["blockPublicAcls"] = False
    mapped_result = mapper.map(full_s3_config)
    assert mapped_result[0].is_public == "Yes", "After changing the sample json, the bucket is no longer blocking all public access"

    # These keys may not be present, verify that mapping still works if the keys don't exist in the dictionary
    full_s3_config["supplementaryConfiguration"].pop("PublicAccessBlockConfiguration", None)
    mapped_result = mapper.map(full_s3_config)
    assert mapped_result[0].is_public == "Yes", "Without PublicAccessBlockConfiguration, the bucket is public "

    full_s3_config.pop("supplementaryConfiguration", None)
    mapped_result = mapper.map(full_s3_config)
    assert mapped_result[0].is_public == "Yes", "Without supplementaryConfiguration, the bucket is public"

def test_given_resource_type_is_specified_in_region(full_s3_config):
    mapper = S3DataMapper()

    mapped_result = mapper.map(full_s3_config)
    assert mapped_result[0].location == "us-west-2"

def test_given_resource_type_is_commented_based_on_encryption_status(full_s3_config):
    mapper = S3DataMapper()

    mapped_result = mapper.map(full_s3_config)
    assert mapped_result[0].comments == "Not encrypted", "Bucket has no encryption settings"

import json
import os
import pytest
from inventory.mappers import VPCDataMapper

@pytest.fixture()
def full_vpc_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_vpc.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)

def test_given_resource_type_is_not_vpc_then_empty_array_is_returned(full_vpc_config):
    full_vpc_config["resourceType"] = "NOT VPC"

    mapper = VPCDataMapper()

    assert mapper.map(full_vpc_config) == []

    full_vpc_config["resourceType"] = "AWS::EC2::VPC"
    assert len(mapper.map(full_vpc_config)) > 0, "Resource should have been mapped"

def test_given_resource_is_mapped_to_unique_id(full_vpc_config):
    mapper = VPCDataMapper()
    assert mapper.map(full_vpc_config)[0].unique_id == "arn:aws:ec2:us-west-2:123456789:vpc/vpc-12345"

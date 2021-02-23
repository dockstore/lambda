import json
import os
import pytest
from inventory.mappers import RDSDataMapper

@pytest.fixture()
def full_rds_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_rds_instance.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)


def test_given_resource_type_is_not_rds_then_empty_array_is_returned(full_rds_config):
    full_rds_config["resourceType"] = "NOT RDS"

    mapper = RDSDataMapper()

    assert mapper.map(full_rds_config) == []

    full_rds_config["resourceType"] = "AWS::RDS::DBInstance"
    assert len(mapper.map(full_rds_config)) > 0, "Resource should have been mapped"


def test_given_resource_is_mapped_to_region(full_rds_config):
    mapper = RDSDataMapper()

    mapped_result = mapper.map(full_rds_config)
    assert mapped_result[0].location == "us-west-2", "Resource should be contained in us-west-2"


def test_given_resource_configuration_contains_resource_specifications(full_rds_config):
    mapper = RDSDataMapper()

    mapped_result = mapper.map(full_rds_config)
    assert mapped_result[0].hardware_model == "db.r5.large", "Resource should contain a hardware model"
    assert mapped_result[0].software_product_name == "aurora-mysql", "Resource should contain database software type"

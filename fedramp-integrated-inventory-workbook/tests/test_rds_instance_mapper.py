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

    full_rds_config["resourceType"] = "AWS::RDS::Bucket"
    assert len(mapper.map(full_rds_config)) > 0, "Resource should have been mapped"

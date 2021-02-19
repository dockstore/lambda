import json
import os
import pytest
from inventory.mappers import SubnetDataMapper


@pytest.fixture()
def full_subnet_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_subnet.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)


@pytest.fixture()
def full_route_table_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_route_table.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)


def test_given_resource_type_is_not_subnet_then_empty_array_is_returned(full_subnet_config):
    full_subnet_config["resourceType"] = "NOT subnet"

    mapper = SubnetDataMapper()

    assert mapper.map(full_subnet_config) == []

    # TODO
    # full_subnet_config["resourceType"] = "AWS::EC2::subnet"
    # assert len(mapper.map(full_subnet_config)) > 0, "Resource should have been mapped"


def test_subnet_publicity_based_on_route_tables(full_subnet_config, full_route_table_config):
    # TODO
    pass
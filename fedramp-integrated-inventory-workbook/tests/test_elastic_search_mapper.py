import json
import os
import pytest
from inventory.mappers import ElasticSearchDataMapper

@pytest.fixture()
def full_classic_elb_config():
    with open(os.path.join(os.path.dirname(__file__), "sample_config_query_results/sample_elastic_search.json")) as file_data:
        file_contents = file_data.read()

    return json.loads(file_contents)

def test_given_elastic_search_then_base_attributes_mapped(full_ES_config):
    mapper = ElasticSearchDataMapper()

    mapped_result = mapper.map(full_ES_config)

    assert len(mapped_result) == 1, "Expected one row to be mapped"
    assert mapped_result[0].unique_id == full_ES_config["arn"], "ARN should be mapped to unique id"

def test_given_elastic_search_then_configuration_noted(full_ES_config):
    mapper = ElasticSearchDataMapper()

    mapped_result = mapper.map(full_ES_config)

    assert len(mapped_result) == 1, "Expected one row to be mapped"
    assert mapped_result[0].baseline_config == full_ES_config["configuration"]["elasticsearchVersion"], "ElasticSearch version should be noted"

def test_given_elastic_search_then_user_friendly_name_recorded(full_ES_config):
    mapper = ElasticSearchDataMapper()

    mapped_result = mapper.map(full_ES_config)

    assert len(mapped_result) == 1, "Expected one row to be mapped"
    assert mapped_result[0].asset_tag == full_ES_config["resourceName"], "ElasticSearch resource name should be noted"


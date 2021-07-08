import json
import logging
import os
from typing import Iterator, List, Optional
import boto3
from botocore.exceptions import ClientError
from .mappers import DataMapper, EC2DataMapper, ElbDataMapper, DynamoDbTableDataMapper, InventoryData, RdsDataMapper, S3DataMapper, \
    VPCDataMapper, LambdaDataMapper

_logger = logging.getLogger("inventory.readers")
_logger.setLevel(os.environ.get("LOG_LEVEL", logging.DEBUG))


class AwsConfigInventoryReader():
    def __init__(self, lambda_context, mappers=None):
        if mappers is None:
            mappers = [EC2DataMapper(), ElbDataMapper(), DynamoDbTableDataMapper(), RdsDataMapper(), S3DataMapper(), VPCDataMapper(),
                       LambdaDataMapper()]
        self._lambda_context = lambda_context
        self._mappers: List[DataMapper] = mappers

    # Moved into it's own method to make it easier to mock boto3 client
    def _get_config_client(self, sts_response, region: str) -> boto3.client:
        sts_response = sts_response.get_frozen_credentials()
        return boto3.client('config',
                            aws_access_key_id=sts_response.access_key,
                            aws_secret_access_key=sts_response.secret_key,
                            aws_session_token=sts_response.token,
                            region_name=region)

    def _get_resources_from_account(self, account_id: str, region_list: List[str]) -> Iterator[List[str]]:
        try:
            _logger.info(f"assuming role on account {account_id}")

            # get the credentials for the current role assumed by the lambda
            sts_response = boto3.Session().get_credentials()

            for region in region_list:
                curr_client = boto3.client('sts', region_name=region)
                sts_response = boto3.Session().get_credentials()
                config_client = self._get_config_client(sts_response, region)

                my_session = boto3.session.Session()
                my_region = my_session.region_name

                _logger.info(f"assuming role on account {account_id} for region {my_region}")

                next_token: str = ''
                while True:
                    resources_result = config_client.select_resource_config(
                        Expression="SELECT arn, resourceName, resourceId, resourceType, configuration, supplementaryConfiguration, configurationStateId, tags, awsRegion "
                                   "WHERE resourceType IN ('AWS::EC2::Instance', 'AWS::ElasticLoadBalancingV2::LoadBalancer', "
                                   "'AWS::ElasticLoadBalancing::LoadBalancer', 'AWS::RDS::DBInstance', "
                                   "'AWS::Lambda::Function', 'AWS::EC2::VPC', 'AWS::S3::Bucket')",
                        NextToken=next_token)

                    next_token = resources_result.get('NextToken', '')
                    results: List[str] = resources_result.get('Results', [])

                    _logger.debug(f"Region {region} page returned {len(results)} and next token of '{next_token}'")

                    yield results

                    if not next_token:
                        break

        except ClientError as ex:
            _logger.error("Received error: %s while retrieving resources from account %s, moving onto next account.", ex, account_id,
                          exc_info=True)

            yield []

    def _get_aws_partition(self):
        arn_parts = self._lambda_context.invoked_function_arn.split(":")

        return arn_parts[1] if len(arn_parts) >= 1 else ''

    def get_resources_from_all_accounts(self) -> List[InventoryData]:
        _logger.info("starting retrieval of inventory from AWS Config")

        all_inventory: List[InventoryData] = []
        accounts = json.loads(os.environ["ACCOUNT_LIST"])

        for account in accounts:
            region_list = account["regions"]
            _logger.info(f"retrieving inventory for account {account['id']} in regions {region_list}")

            for resource_list_page in self._get_resources_from_account(account["id"], region_list):
                _logger.debug(f"current page of inventory contained {len(resource_list_page)} items from AWS Config")

                for raw_resource in resource_list_page:
                    resource: dict = json.loads(raw_resource)

                    # One line item returned from AWS Config can result in multiple inventory line items (e.g. multiple IPs)
                    # Mappers that do not support the resource type will return False
                    mapper: Optional[DataMapper] = next((mapper for mapper in self._mappers if mapper.can_map(resource["resourceType"])),
                                                        None)

                    if not mapper:
                        _logger.warning(f"skipping mapping, unable to find mapper for resource type of {resource['resourceType']}")

                        continue

                    if len(inventory_items := mapper.map(resource)) > 0:
                        all_inventory.extend(inventory_items)

        _logger.info(f"completed getting inventory, with a total of {len(all_inventory)}")

        return all_inventory

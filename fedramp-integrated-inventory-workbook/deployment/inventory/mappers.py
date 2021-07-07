import copy
import logging
import os
from typing import List
from abc import ABC, abstractmethod

_logger = logging.getLogger("inventory.mappers")
_logger.setLevel(os.environ.get("LOG_LEVEL", logging.INFO))


def _get_tag_value(tags: dict, tag_name: str) -> str:
    return next((tag["value"] for tag in tags if "key" in tag and tag["key"].casefold() == tag_name.casefold()), '')


class InventoryData:
    def __init__(self, *, asset_type=None, unique_id=None, ip_address=None, location=None, is_virtual=None,
                 authenticated_scan_planned=None, dns_name=None, mac_address=None, baseline_config=None, hardware_model=None,
                 is_public=None, network_id=None, owner=None, software_product_name=None, software_vendor=None, comments=None,
                 in_latest_scan=None, purpose=None, asset_tag=None):
        self.asset_type = asset_type
        self.unique_id = unique_id
        self.ip_address = ip_address
        self.location = location
        self.is_virtual = is_virtual
        self.authenticated_scan_planned = authenticated_scan_planned
        self.dns_name = dns_name
        self.mac_address = mac_address
        self.baseline_config = baseline_config
        self.hardware_model = hardware_model
        self.is_public = is_public
        self.network_id = network_id
        self.owner = owner
        self.software_product_name = software_product_name
        self.software_vendor = software_vendor
        self.comments = comments
        self.in_latest_scan = in_latest_scan
        self.purpose = purpose
        self.asset_tag = asset_tag


class DataMapper(ABC):
    REQUIRES_MANUAL_INPUT = "TODO"

    @abstractmethod
    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        pass

    @abstractmethod
    def _get_supported_resource_type(self) -> List[str]:
        pass

    def can_map(self, resource_type: str) -> bool:
        return resource_type in self._get_supported_resource_type()

    def map(self, config_resource: dict) -> List[InventoryData]:
        if not self.can_map(config_resource["resourceType"]):
            return []

        mapped_data = []

        _logger.debug(f"mapping {config_resource['resourceType']}")
        _logger.debug(config_resource)
        mapped_data.extend(self._do_mapping(config_resource))

        _logger.debug(f"mapping resulted in a total of {len(mapped_data)} rows")

        return mapped_data


class EC2DataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::EC2::Instance"]

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        ec2_data_list: List[InventoryData] = []

        for nic in config_resource["configuration"]["networkInterfaces"]:
            for ipAddress in nic["privateIpAddresses"]:
                ec2_data = {"asset_type": "EC2",
                            "unique_id": config_resource["configuration"]["instanceId"],
                            "ip_address": ipAddress["privateIpAddress"],
                            "is_virtual": "Yes",
                            "authenticated_scan_planned": "Yes",
                            "in_latest_scan": self.REQUIRES_MANUAL_INPUT,
                            "software_vendor": "AWS",
                            "mac_address": nic["macAddress"],
                            "baseline_config": config_resource["configuration"]["imageId"],
                            "hardware_model": config_resource["configuration"]["instanceType"],
                            "network_id": config_resource["configuration"]["vpcId"],
                            "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                            "owner": _get_tag_value(config_resource["tags"], "owner")}

                if (public_dns_name := config_resource["configuration"].get("publicDnsName")):
                    ec2_data["dns_name"] = public_dns_name
                    ec2_data["is_public"] = "Yes"
                else:
                    ec2_data["dns_name"] = config_resource["configuration"]["privateDnsName"]
                    ec2_data["is_public"] = "No"

                if "association" in ipAddress:
                    # Add a publicIp address it the ip_address field if necessary
                    ec2_data["ip_address"] += "," + ipAddress["association"]["publicIp"]

                ec2_data_list.append(InventoryData(**ec2_data))

        return ec2_data_list


class ElbDataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::ElasticLoadBalancing::LoadBalancer", "AWS::ElasticLoadBalancingV2::LoadBalancer"]

    def _get_asset_type_name(self, config_resource: dict) -> str:
        if config_resource["resourceType"] == "AWS::ElasticLoadBalancing::LoadBalancer":
            return "Load Balancer-Classic"
        else:
            return f"Load Balancer-{config_resource['configuration']['type']}"

    def _get_ip_addresses(self, availabilityZones: dict) -> List[str]:
        ip_addresses: List[str] = []

        for availabilityZone in availabilityZones:
            if load_balancer_addresses := availabilityZone.get("loadBalancerAddresses"):
                for load_balancer_address in (load_balancer_address for load_balancer_address in load_balancer_addresses if
                                              "ipAddress" in load_balancer_address):
                    ip_addresses.append(load_balancer_address["ipAddress"])

        return ip_addresses

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        data_list: List[InventoryData] = []

        data = {"asset_type": self._get_asset_type_name(config_resource),
                "unique_id": config_resource["arn"],
                "is_virtual": "Yes",
                "software_vendor": "AWS",
                "is_public": "Yes" if config_resource["configuration"]["scheme"] == "internet-facing" else "No",
                # Classic ELBs have key of "vpcid" while V2 ELBs have key of "vpcId"
                "network_id": config_resource["configuration"]["vpcId"] if "vpcId" in config_resource["configuration"] else
                config_resource["configuration"]["vpcid"],
                "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                "owner": _get_tag_value(config_resource["tags"], "owner")}

        if len(ip_addresses := self._get_ip_addresses(config_resource["configuration"]["availabilityZones"])) > 0:
            for ip_address in ip_addresses:
                data = copy.deepcopy(data)

                data["ip_address"] = ip_address

                data_list.append(InventoryData(**data))
        else:
            data_list.append(InventoryData(**data))

        return data_list


class RdsDataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::RDS::DBInstance"]

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        data = {"asset_type": "RDS",
                "unique_id": config_resource["arn"],
                "is_virtual": "Yes",
                "software_vendor": "AWS",
                "authenticated_scan_planned": "No",
                "purpose": self.REQUIRES_MANUAL_INPUT,
                "is_public": "Yes" if config_resource["configuration"]["publiclyAccessible"] else "No",
                "hardware_model": config_resource["configuration"]["dBInstanceClass"],
                "software_product_name": f"{config_resource['configuration']['engine']}-{config_resource['configuration']['engineVersion']}",
                "network_id": config_resource['configuration']['dBSubnetGroup']['vpcId'] if "dBSubnetGroup" in config_resource[
                    'configuration'] else '',
                "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                "owner": _get_tag_value(config_resource["tags"], "owner"),
                "location": config_resource["awsRegion"]}

        return [InventoryData(**data)]


class DynamoDbTableDataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::DynamoDB::Table"]

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        data = {"asset_type": "DynamoDB",
                "unique_id": config_resource["arn"],
                "is_virtual": "Yes",
                "is_public": "No",
                "software_vendor": "AWS",
                "software_product_name": "DynamoDB",
                "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                "owner": _get_tag_value(config_resource["tags"], "owner")}

        return [InventoryData(**data)]


class S3DataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::S3::Bucket"]

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:

        if "supplementaryConfiguration" in config_resource and "PublicAccessBlockConfiguration" in config_resource["supplementaryConfiguration"]:
            # check if each of the block access config values are true, if so, then the bucket is not public
            public_access_config = config_resource["supplementaryConfiguration"]["PublicAccessBlockConfiguration"]
            is_public = "No" if all(public_access_config[key] for key in public_access_config) else "Yes"
        else:
            # if there is no PublicAccessBlockConfiguration then this bucket is public
            is_public = "Yes"

        data = {"asset_type": "S3",
                "unique_id": config_resource["arn"],
                "is_virtual": "Yes",
                "is_public": is_public,
                "software_vendor": "AWS",
                "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                "owner": _get_tag_value(config_resource["tags"], "owner"),
                "comments": "Encrypted" if "ServerSideEncryptionConfiguration" in config_resource["supplementaryConfiguration"] else "Not encrypted",
                "location": config_resource["awsRegion"]
                }

        return [InventoryData(**data)]


class VPCDataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::EC2::VPC"]

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        data = {"asset_type": "VPC",
                "unique_id": config_resource["arn"],
                "ip_address": config_resource["configuration"]["cidrBlock"],
                "is_virtual": "Yes",
                "is_public": "Yes",
                "software_vendor": "AWS",
                "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                "baseline_config": config_resource["configurationStateId"],
                "network_id": config_resource["configuration"]["vpcId"],
                "owner": _get_tag_value(config_resource["tags"], "owner"),
                "location": config_resource["awsRegion"]
                }

        return [InventoryData(**data)]


class LambdaDataMapper(DataMapper):
    def _get_supported_resource_type(self) -> List[str]:
        return ["AWS::Lambda::Function"]

    def _do_mapping(self, config_resource: dict) -> List[InventoryData]:
        data = {"asset_type": "Lambda Function",
                "unique_id": config_resource["arn"],
                "is_virtual": "Yes",
                "is_public": "No",
                "baseline_config": config_resource["configuration"]["runtime"],
                "software_vendor": "Dockstore",
                "software_product_name": "sha256: " + config_resource["configuration"]["codeSha256"],
                "asset_tag": config_resource["resourceName"] if "resourceName" in config_resource else config_resource["resourceId"],
                "purpose": self.REQUIRES_MANUAL_INPUT,
                "owner": _get_tag_value(config_resource["tags"], "owner"),
                "location": config_resource["awsRegion"]
                }

        return [InventoryData(**data)]

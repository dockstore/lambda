from .readers import AwsConfigInventoryReader
from .reports import CreateReportCommandHandler, DeliverReportCommandHandler

def lambda_handler(event, context):
    inventory = AwsConfigInventoryReader(lambda_context=context).get_resources_from_all_accounts()

    report_path = CreateReportCommandHandler().execute(inventory)
    report_url = DeliverReportCommandHandler().execute(report_path)

    return {'statusCode': 200,
            'body': {
                    'report': { 'url': report_url }
                }
            }

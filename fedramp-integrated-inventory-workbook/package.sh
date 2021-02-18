rm -fr output
mkdir output
cp -R src/inventory output
pipenv lock -r > requirements.txt
pipenv run pip install -r requirements.txt -t output -U --no-deps
chmod -R 755 output
rm -f fedramp-inventory-lambda.zip
(cd output && zip -r8 ../fedramp-inventory-lambda.zip .)
rm -fr output

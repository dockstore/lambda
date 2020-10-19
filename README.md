# lambda
Till we find a better solution, backup and document AWS lambdas

## Installing git-secrets
Dockstore uses git-secrets to help make sure that keys and private data stay out
of the source tree.
To install and check for git secrets:

```
npm ci
npm run install-git-secrets
```
 
This should install git secrets into your local repository and perform a scan. 
If secrets are found, the run will error and output the potential secret to stdout.
If you believe the scan is a false-positive, add the line glob to .gitallowed.

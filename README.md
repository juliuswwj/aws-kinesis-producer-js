# pure nodejs module for aws kinesis put media

This library can run on nodejs v8 and iotjs master branch (>20190301).
To use on iotjs, `iotjs.patch` should be applied in iotjs source directory.

# test
put your config in /tmp/aws.cfg
```
{
   "stream": "test1",
   "key": "...",
   "keyid": "...",
   "region": "us-west-2"
}
```

and run following command
```
node test.js
```

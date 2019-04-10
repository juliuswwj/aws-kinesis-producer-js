# PURE javascript nodejs/iotjs module for aws kinesis producer

[![Build Status](https://travis-ci.com/juliuswwj/aws-kinesis-producer-js.svg?branch=master)](https://travis-ci.com/juliuswwj/aws-kinesis-producer-js)

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

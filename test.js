'use strict'

var fs = require('fs');
var https = require('https');
var sdk = require('.');

var tests = [];
function test(msg, eret, cb){
    if(cb){
        var ncb = cb;
        cb = function(resovle){
            console.log('test', msg);
            try {
                if( ncb() === eret ){
                    resovle();
                    return;
                }
            }
            catch(err){
                if(eret instanceof Error && err.message.indexOf(eret.message) > 0){
                    resolve();
                } else {
                    throw err;
                }
            }
            throw new Error('#result not equal');
        };
    } else {
        if(typeof msg !== 'function') throw "E: call test with single none-Promise parameter";
        cb = msg;
    }

    tests.push(cb);
}

function testrun(){
    if(tests.length == 0) return;
    var t = tests.shift();

    function resolve(){
        process.nextTick(testrun);
    }

    try {
        t(resolve);
    }
    catch(err){
        throw err;
        console.log("****** test failed for " + err.toString());
    }
}


test('aws4', true, function(){
    // POST /describeStream HTTP/1.1
    // host: kinesisvideo.us-west-2.amazonaws.com
    // Accept: */*
    // Authorization: AWS4-HMAC-SHA256 Credential=AKIAQQ5CSGFCFJ55CLH3/20190402/us-west-2/kinesisvideo/aws4_request, SignedHeaders=content-type;host;user-agent;x-amz-date, Signature=879d1e592b14db44a5586858b32b9dfd59703fb32ed0ba8022225bda7ca7beda
    // content-type: application/json
    // user-agent: AWS-SDK-KVS/1.7.9 Clang/10.0.1 Darwin/18.5.0 x86_64
    // X-Amz-Date: 20190404T014442Z
    // Content-Length: 23
    // {"StreamName":"test1"}\n
    var req = {
        method: 'POST',
        path: '/describeStream',
        headers: {
            host: 'kinesisvideo.us-west-2.amazonaws.com',
            'content-type': 'application/json',
            'user-agent': 'AWS-SDK-KVS/1.7.9 Clang/10.0.1 Darwin/18.5.0 x86_64',
            'x-amz-date': '20190404T014442Z',
        }
    };


    var options = {
        service: 'kinesisvideo',
        region: 'us-west-2',
        keyid: 'AKIAQQ5CSGFCFJ55CLH3',
        key: '2dnE4HQ6/lw0Ae0ujgP5TWTWMBhumKujq/tx/xX6'
    };

    sdk.genAWS4Auth(req, '{"StreamName":"test1"}\n', options);
    return req.headers['Authorization'].indexOf('879d1e592b14db44a5586858b32b9dfd59703fb32ed0ba8022225bda7ca7beda') > 0;
});

var mkvin = '/tmp/sample.mkv';
var mkvout = '/tmp/test.mkv';

test(function(resovle){
    if( ! fs.existsSync(mkvin) ){
        console.log('downloading', mkvin);
        https.get("https://sample-videos.com/video123/mkv/720/big_buck_bunny_720p_30mb.mkv", function(response) {
            var file = fs.createWriteStream(mkvin);
            response.pipe(file);
            response.on('end', resovle);
        });
    } else {
        resovle();
    }
});

function putData(mkv, data)
{
    var n = data.readUInt8(0) & 0x7f;
    var type = data.readUInt8(3);
    data = data.slice(4);

    if(n == 2) type |= 0x100;
    mkv.putFrame(data, type);
}

test('convert', true, function(){
    var fw = fs.openSync(mkvout, 'w');
    var ex = new sdk.MKVExtractor(mkvin);
    
    function write(data){
        //console.log('write', data.length);
        for(var i=0, l=data.length; i < l; i++){
            fs.writeSync(fw, data[i]);
        }
    }

    var mkv;
    function writecb(options, data){
        if(!options.stream){
            options.stream = 'test';
            mkv = sdk.MKVBuilder(options, write);
        }
        putData(mkv, data);
        return true;
    };

    while(ex.run(writecb)){
        // ...
    }
    fs.closeSync(fw);
    return true;
});

test(function(resovle){
    try{
        var spawn = require('child_process').spawn;
    }
    catch(err){
        console.log('iotjs');
        resovle();
        return;
    }

    console.log('run mkvinfo');

    var bcnt = 0;
    var mkvinfo = spawn('mkvinfo', ['-v', mkvout]);
    mkvinfo.stdout.on('data', function(data){
        if(data.indexOf('SimpleBlock') > 0) bcnt += 1;
        if(data.indexOf('Unknown element') > 0)
            throw new Error('invalid mkvinfo result');
    });
    mkvinfo.stdout.on('end', function() {
        if(bcnt < 50) throw new Error('invalid mkvinfo result');
        resovle();
    });
});



function testserver(){
    var net = require('net');
    var fw = fs.openSync('/tmp/test.txt', 'w');
    var s = net.createServer(function(c){
        c.write('HTTP/1.0 200 Ok\r\n\r\n');

        var cnt = 0;
        var itm = setInterval(function(){
            var ob = {
                EventType: 'Received',
                FragmentTimecode: cnt*1000,
                FragmentNumber: cnt,
                ErrorId: 0,
            };
            c.write(JSON.stringify({Acknowledgement:ob}) + '\r\n');
        }, 3000);

        var hex = false;
        c.on('data', function(data){
            if(!hex){
                var ptr = data.indexOf('\r\n\r\n');
                fs.writeSync(fw, '-- HDR\n');
                if(ptr > 0){
                    fs.writeSync(fw, data.slice(0, ptr+4).toString());
                    hex = true;
                } else {
                    fs.writeSync(fw, data.toString());
                }
                if(!hex) return;
                data = data.slice(ptr+4);
            }
            fs.writeSync(fw, '-- DATA_OUT\n');
            for(var i=0, l=data.length; i < l; i+=16){
                var t = i+16<=l ? data.slice(i, i+16) : data.slice(i);
                fs.writeSync(fw, t.toString('hex'));
                fs.writeSync(fw, '\n');
            }
        });

        c.on('end', function(){
            clearInterval(itm);
        });
    });
    s.on('error', function(e){
        console.log('testserver', e);
    });
    s.listen(8000, function(){
        console.log('testserver bind on 8000');
    });
}


test(function(resolve){
    //testserver();

    var ex = new sdk.MKVExtractor(mkvin);
    var itm;
    var s;
    
    function showmessage(err, msg, data){
        if(err){
            console.log('E:', err);
            return;
        }
        console.log('--', msg, data);
        if(msg == 'end'){
            s.end();
            clearInterval(itm);
            resolve();
        }
    }

    function writecb(options, data){
        if(!options.stream){
            var cfg = JSON.parse( fs.readFileSync('/tmp/aws.cfg') );
            for(var n in cfg) options[n] = cfg[n];
            s = sdk.Kinesis(options);
            s.start(showmessage);
        } 
        putData(s, data);
        return true;
    };

    itm = setInterval(function(){
        if(!ex.run(writecb)){
            clearInterval(itm);
            resolve();
        }
    }, 30);
});


console.log('start');
testrun();


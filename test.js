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
        console.log("****** test failed for " + err.toString());
    }
}


function MKVExtractor(fname){
    this.fd = fs.openSync(fname, 'r');
    this.rptr = 0;
    var hdr = this.ebml();
    if(hdr.id != 0xA45DFA3){
        throw new Error('invalid MKV file');
    }
    this.options = {};
    this.baserptr = this.rptr;
};

MKVExtractor.prototype.reset = function(){
    this.rptr = this.baserptr;
};

function getnum(buf){
    var c = 0;
    var i = 0;
    for(i=0; i<8; i++){
        if(buf[i] == 0) continue;
        if(buf[i] == 0xff) {
            return [-1, i+1];
        }
        if(buf[i] & 128) { c = 0; break; }
        if(buf[i] & 64) { c = 1; break; }
        if(buf[i] & 32) { c = 2; break; }
        if(buf[i] & 16) { c = 3; break; }
        if(buf[i] & 8) { c = 4; break; }
        if(buf[i] & 4) { c = 5; break; }
        if(buf[i] & 2) { c = 6; break; }
        if(buf[i] & 1) { c = 7; break; }
    }
    var v = buf[i] & ((1<<(7-c))-1);
    i += 1;
    var rc = i + c;
    while(c > 0){
        v = v * 256 + buf[i];
        c -= 1;
        i += 1;
    }
    //console.log('getint', buf, v.toString(16));
    return [v, rc];
}

function getint(buf){
    if(buf.length == 1) return buf[0];
    if(buf.length == 2) return buf.readUInt16BE(0);
    if(buf.length == 4) return buf.readUInt32BE(0);
    return -1;
}


MKVExtractor.prototype.getnum = function(){
    var buf = new Buffer(8);
    fs.readSync(this.fd, buf, 0, buf.length, this.rptr);
    var v = getnum(buf);
    this.rptr += v[1];
    return v[0];
}

MKVExtractor.prototype.ebml = function(){
    var id = this.getnum();
    var len = this.getnum();
    if(len <= 0 || id == 0x8538067 || id == 0x654AE6B || id == 0xF43B675 || id == 0x2e) // dont read stream, tracks, cluster, track data
        return {id: id, len: len};
    var data = new Buffer(len);
    fs.readSync(this.fd, data, 0, data.length, this.rptr);
    this.rptr += len;
    return {id: id, data: data};
}

MKVExtractor.prototype.run = function(cb){
    var options = this.options;
    var t = null;

    while(true){
        var e = this.ebml();
        if(e.id == 0) return false;

        if(e.id == 0x6) {
            t.codec = e.data.toString('utf8');
    
        } else if(e.id == 0x23){
            return cb(options, e.data);

        } else if(e.id == 0x67){
            options.tsbase = getint(e.data);

        } else if(e.id == 0x57) {
            t = {};
            if(getint(e.data) == 1){
                options.v = t;
            } else {
                options.a = t;
            }
        }
        else if(e.id == 0x60) {
            t.width = getint(e.data.slice(2, 4));
            t.height = getint(e.data.slice(6, 8));
        }
        else if(e.id == 0x61) {
            t.channels = e.data[2]; // 9f 81
            t.freq = e.data.slice(5).readDoubleBE();
        }
        else if(e.id == 0x23a2){
            t.data = e.data;
        }
        else if(e.id == 0x3E383){
            t.duration = getint(e.data);
        } 
        //else console.log(e);
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
            const file = fs.createWriteStream(mkvin);
            response.pipe(file);
            response.on('end', resovle);
        });
    } else {
        resovle();
    }
});


test('convert', true, function(){
    var fw = fs.openSync(mkvout, 'w');
    var ex = new MKVExtractor(mkvin);
    
    function write(data){
        //console.log('write', data.length);
        for(var i=0, l=data.length; i < l; i++){
            fs.writeSync(fw, data[i]);
        }
    }

    var mkv;
    function writecb(options, data){
        if(!options.stream){
            options.v.duration /= 1000*1000;
            options.stream = 'test';
            mkv = sdk.MKVBuilder(options, write);
        } 
        var n = getnum(data);
        var type = data[n[1] + 2];
        data = data.slice(n[1] + 3);
    
        if(n[0] == 2) type |= 0x100;
        mkv.putFrame(data, type);
        return true;
    };

    while(ex.run(writecb)){
        // ...
    }
    fs.closeSync(fw);
    return true;
});

test(function(resovle){
    const { spawn } = require('child_process');

    console.log('run mkvinfo');

    var bcnt = 0;
    const mkvinfo = spawn('mkvinfo', ['-v', mkvout]);
    mkvinfo.stdout.on('data', (data) => {
        if(data.indexOf('SimpleBlock') > 0) bcnt += 1;
        if(data.indexOf('Unknown element') > 0)
            throw new Error('invalid mkvinfo result');
    });
    mkvinfo.stdout.on('end', (code) => {
        if(bcnt < 50) throw new Error('invalid mkvinfo result');
        resovle();
    });
});



function testserver(){
    const net = require('net');
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



// node test.js region keyid key
if(process.argv.length >= 5) test(function(resolve){
    //testserver();

    var ex = new MKVExtractor(mkvin);
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
            options.v.duration /= 1000*1000;
            options.stream = 'test1';
            options.region = process.argv[2];
            options.keyid = process.argv[3];
            options.key = process.argv[4];
            s = sdk.Kinesis(options);
            s.start(showmessage);
        } 
        var n = getnum(data);
        var type = data[n[1] + 2];
        data = data.slice(n[1] + 3);
    
        if(n[0] == 2) type |= 0x100;
        s.putFrame(data, type);
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


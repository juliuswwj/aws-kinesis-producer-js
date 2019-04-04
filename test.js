'use strict'

var fs = require('fs');
var sdk = require('.');


// POST /putMedia HTTP/1.1
// host: s-4010bf70.kinesisvideo.us-west-2.amazonaws.com
// Accept: */*
// Authorization: AWS4-HMAC-SHA256 Credential=AKIAQQ5CSGFCFJ55CLH3/20190402/us-west-2/kinesisvideo/aws4_request, SignedHeaders=connection;host;transfer-encoding;user-agent;x-amz-date;x-amzn-fragment-acknowledgment-required;x-amzn-fragment-timecode-type;x-amzn-producer-start-timestamp;x-amzn-stream-name, Signature=61d08f50dd3fb117e3447b5c4230d6a9c5fc1acdbd5d6a2ecb7f244be1d84fb3
// connection: keep-alive
// transfer-encoding: chunked
// user-agent: AWS-SDK-KVS/1.7.9 Clang/10.0.1 Darwin/18.5.0 x86_64
// X-Amz-Date: 20190402T225203Z
// x-amzn-fragment-acknowledgment-required: 1
// x-amzn-fragment-timecode-type: RELATIVE
// x-amzn-producer-start-timestamp: 1554245523.434
// x-amzn-stream-name: test1
// Content-Type: application/x-www-form-urlencoded
// Expect: 100-continue

var req1 = {
    method: 'POST',
    path: '/putMedia',
    headers: {
        host: 's-4010bf70.kinesisvideo.us-west-2.amazonaws.com',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
        'user-agent': 'AWS-SDK-KVS/1.7.9 Clang/10.0.1 Darwin/18.5.0 x86_64',
        'x-amz-date': '20190402T225203Z',
        'x-amzn-fragment-acknowledgment-required': '1',
        'x-amzn-fragment-timecode-type': 'RELATIVE',
        'x-amzn-producer-start-timestamp': '1554245523.434',
        'x-amzn-stream-name': 'test1',
    }
};

// POST /describeStream HTTP/1.1
// host: kinesisvideo.us-west-2.amazonaws.com
// Accept: */*
// Authorization: AWS4-HMAC-SHA256 Credential=AKIAQQ5CSGFCFJ55CLH3/20190402/us-west-2/kinesisvideo/aws4_request, SignedHeaders=content-type;host;user-agent;x-amz-date, Signature=879d1e592b14db44a5586858b32b9dfd59703fb32ed0ba8022225bda7ca7beda
// content-type: application/json
// user-agent: AWS-SDK-KVS/1.7.9 Clang/10.0.1 Darwin/18.5.0 x86_64
// X-Amz-Date: 20190404T014442Z
// Content-Length: 23
// {"StreamName":"test1"}\n
var req2 = {
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

//sdk.genAWS4Auth(req1, '', options);
//console.log(req1.headers['Authorization']);
sdk.genAWS4Auth(req2, '{"StreamName":"test1"}\n', options);
console.log(req2.headers['Authorization']);


function MKVExtractor(fname){
    this.fd = fs.openSync(fname, 'r');
    this.rptr = 0;
    var hdr = this.ebml();
    if(hdr.id != 0xA45DFA3){
        throw new Error('invalid MKV file');
    }
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
    var options = {};
    var t = null;

    while(true){
        var e = this.ebml();
        if(e.id == 0) break;

        if(e.id == 0x6) {
            t.codec = e.data.toString('utf8');
    
        } else if(e.id == 0x23){
            cb(options, e.data);

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

var fw = fs.openSync('/tmp/test.mkv', 'w');
var ex = new MKVExtractor('other/sample.mkv');
var mkv;

function write(data, push){
    console.log('write', data.length);
    for(var i=0, l=data.length; i < l; i++){
        fs.writeSync(fw, data[i]);
    }
}

ex.run(function(options, data){
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
});


fs.closeSync(fw);

console.log('done');

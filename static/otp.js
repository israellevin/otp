function nicedate(d){
    if('undefined' === typeof(d)) d = new Date();
    var padded = $.map(
        [
            d.getMonth() + 1,
            d.getDate(),
            d.getHours(),
            d.getMinutes(),
            d.getSeconds()
        ],
        function(c){
            return (c < 10 ? '0' : '') + c;
        }
    );
    padded.unshift(d.getFullYear());
    return padded.slice(0, 3).join('-') + ' ' +  padded.slice(3).join(':');
}

function log(msg){
    console.log(arguments);
    if('string' === typeof msg) $('#log').prepend($('<div>').html(nicedate() + ' ' + msg));
}

function findroot(leafid){
    try{return findroot(secrets[leafid].parent_) || leafid;}
    catch(err){return 'undefined' !== typeof(secrets[leafid]) && leafid;}
}

function scanforward(rootid){
    var members = [], unviewed = [];
    if(secrets[rootid]){
        members.push(rootid);
        if('string' !== typeof(secrets[rootid].body)){
            unviewed.push(rootid);
        }
        $.each(secrets[rootid].children, function(idx, childid){
            var childscan = scanforward(childid);
            members = members.concat(childscan.members);
            unviewed = unviewed.concat(childscan.unviewed);
        });
    }
    return {members: members, unviewed: unviewed};
}

function secretdiv(secret){
    return $('<div class=secret>').text(secret.name);
}

$(function(){
    var keys = $.map(secrets, function(secret, key){
        return parseInt(key, 10);
    }).sort();
    var threadsdiv = $('#threads').extend({
        threads: [],
        addthread: function(thread){
            $('<div>').text(secrets[thread.root].name).appendTo(threadsdiv);
        }
    });
    var thread;
    while(keys.length > 0){
        thread = scanforward(keys[0]);
        thread.root = keys[0];
        if(thread.unviewed.length > 0){
            thread.firstunviewed = Math.min.apply(null, thread.unviewed);
            thread.target = secrets[thread.firstunviewed].parent_;
        }else{
            thread.target = Math.max.apply(null, thread.members);
        }
        $.each(thread.members, function(idx, key){
            var pos = keys.indexOf(key);
            if(pos > -1) keys.splice(pos, 1);
        });
        threadsdiv.addthread(thread);
    }
    body = $('body');
    $.each(secrets, function(key, secret){
        body.append(secretdiv(secret))
    });
    $('#nojs').remove();
});

function jsonp(method, data, callback){
    $.ajax({
        url: method,
        dataType: 'jsonp',
        data: data,
        success:function(data){
            if(null !== data && 'string' === typeof data.error) log(data.error);
            callback(data);
        },
        error:function(){
            log('Unable to retrieve ' + method);
        }
    });
}


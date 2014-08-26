var log = console.log;

// General notice: we trust the server to inject the global `secrets` object.

// Create and return a secret div from a viewable secret ID.
function makesecretdiv(secret){
    return $('<div>').html('<h2>' + secret.name + '</h2>');
}

// Draw a secret and everything leading up to it.
function drawsecretsback(secretsdiv, secret){
    secretsdiv.prepend(makesecretdiv(secret));
    if(secret.parentid !== null){
        drawsecretsback(secretsdiv, secrets[secret.parentid]);
    }
}

// Create and return a thread div from a valid thread object.
// This should include at least the following members:
//     rootid - the ID of the root secret
//     targetid - the ID of the secret to be displayed on click
//     secrets - an array of IDs of all the viewable secrets on the tread
//     unviewed - subset of secrets, listing IDs of unviewed ones
function makethreaddiv(thread, secretsdiv){
    var root = secrets[thread.rootid];
    if('undefined' === typeof(root)) return false;
    return $('<div>').
        html('<h2>' + root.name + '</h2>').data('thread', thread).
        addClass('thread ' + (thread.unviewed.length > 0 ? 'unviewed' : 'viewed')).
        click(function(){
            secretsdiv.empty();
            if(thread.targetid === null){
                log('single unread secret', secrets[thread.rootid]);
            }else{
                drawsecretsback(secretsdiv, secrets[thread.targetid]);
            }
        });
    ;
}

// Add a thread to the right place in the threadslist.
// Threads that contain unviewed secrets come first, and are sorted by oldest
// unviewed secret. Threads that do not come after them and are sorted by newest
// (viewed) secret.
function addthread(threadsdiv, secretsdiv, thread){
    var newdiv = makethreaddiv(thread, secretsdiv);
    threadsdiv.find('div.thread').each(function(){
        var existingdiv = $(this);
        var existingthread = existingdiv.data('thread');
        log(existingthread);
        if(thread.unviewed.length > 0){
            if(existingthread.unviewed.length > 0){
                if(thread.oldestunviewed < existingthread.oldestunviewed){
                    return existingdiv.before(newdiv);
                }
            }else{
                return existingdiv.before(newdiv);
            }
        }else{
            if(existingthread.unviewed.length === 0){
                if(thread.targetid > existingthread.targetid){
                    return existingdiv.before(newdiv);
                }
            }
        }
    });
    return threadsdiv.append(newdiv);
}

// Recursively find all the visible descendants of a secret. We create a
// separate containing only unviewed secrets, since this is handy information.
// Also note that the list is self inclusive, since it's used to get threads.
function finddescendants(rootid){
    var descendants = {secrets: [], unviewed: []};
    if(secrets[rootid]){
        descendants.secrets.push(rootid);
        if('string' !== typeof(secrets[rootid].body)){
            descendants.unviewed.push(rootid);
        }
        $.each(secrets[rootid].childids, function(idx, childid){
            $.map(finddescendants(childid), function(value, key){
                descendants[key] = descendants[key].concat(value);
            });
        });
    }
    return descendants;
}

// Initialize.
$(function(){
    var keys = $.map(secrets, function(secret, key){
        return parseInt(key, 10);
    }).sort();
    var threadsdiv = $('#threads');
    var secretsdiv = $('#secrets');
    var thread;
    while(keys.length > 0){
        thread = finddescendants(keys[0]);
        thread.rootid = keys[0];
        if(thread.unviewed.length > 0){
            thread.oldestunviewed = Math.min.apply(null, thread.unviewed);
            thread.targetid = secrets[thread.oldestunviewed].parentid;
        }else{
            thread.targetid = Math.max.apply(null, thread.secrets);
        }
        $.each(thread.secrets, function(idx, key){
            var pos = keys.indexOf(key);
            if(pos > -1) keys.splice(pos, 1);
        });
        addthread(threadsdiv, secretsdiv, thread);
    }
    body = $('body');
    //$.each(secrets, function(key, secret){
        //body.append(makesecretdiv(secret))
    //});
    $('#nojs').remove();
});


// These will come in handy soon.

// Recursively find the oldest visible ancestor of a secret.
function findroot(leafid){
    try{return findroot(secrets[leafid].parentid) || leafid;}
    catch(err){return 'undefined' !== typeof(secrets[leafid]) && leafid;}
}

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

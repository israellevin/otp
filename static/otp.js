// FIXME debug.
var log  = console.log;

(function(){'use strict';

// Iterators.
function each(array, func, thisarg){
    if(thisarg) func = func.bind(thisarg);
    for(var idx = 0, len = array.length; idx < len; idx++){
        if(func(array[idx], idx) === false) break;
    }
}
function map(array, func, thisarg){
    var results = [];
    each(array, function(item){
        var result = func(item);
        if(typeof result !== 'undefined') results.push(result);
    }, thisarg);
    return results;
}
function eachkeyval(dictionary, func, thisarg){
    // FIXME when I get online I should check if its safe.
    each(Object.keys(dictionary), function(key){
        return func(key, dictionary[key]);
    }, thisarg);
}

// Link all the server injected secrets to their relatives.
// Danger: this function modifies it's argument!
// Should probably fix this later.
function linksecrets(secrets){
    eachkeyval(secrets, function(id, secret){
        var idlinker = map(
            ['childid', 'authparentid', 'authchildid'],
            function(key){
                return map(secret[key + 's'], function(id){return secrets[id];});
            }
        );
        secret.children = idlinker[0];
        secret.authparents = idlinker[1];
        secret.authchildren = idlinker[2];
        if(typeof secret.parentid === 'number')
            secret.parent = secrets[secret.parentid];
    });
    return secrets;
}

// Recursively gather a thread of secrets from a root secret.
function threadsecrets(secret){
    if(typeof secret.body === 'undefined') return [];
    var members = [secret];
    each(secret.children, function(child){
        if(
            child.authparentids[0] !== secret.id || (
                child.viewers[child.id] &&
                Object.keys(child.viewers[child.id]).length > 1
            )
        ) return;
        members = members.concat(threadsecrets(child));
    });
    return members;
}

// Create a thread object from a list of members.
function Thread(members){
    this.members = members;
    this.memberids = map(members, function(member){return member.id;}).sort(
        function(a, b){return a.id - b.id;}
    );
    this.name = this.members[0].name;

    var viewers = []
    eachkeyval(this.members[0].viewers, function(_, viewerids){
        each(viewerids, function(viewerid){
            if(viewers.indexOf(viewerid) < 0) viewers.push(viewerid);
        });
    });
    this.viewers = viewers;
}

angular.module('otp', []).controller('secrets', function($scope){

    var secrets = window.s = linksecrets(rawsecrets);
    var threads = window.t = []

    // Pull threads off checklist till we run out of unthreaded secrets.
    var members, checklist = [];
    eachkeyval(secrets, function(_, secret){
        checklist.push(secret);
    });
    while(checklist.length > 0){
        members = threadsecrets(checklist[0]);
        if(members.length === 0){
            // TODO handle unviewed.
            checklist.shift();
            continue;
        }
        threads.unshift(new Thread(members));

        each(members, function(id){
            var pos = checklist.indexOf(id);
            if(pos > -1) checklist.splice(pos, 1);
        });
    }

    $scope.secrets = secrets;
    $scope.threads = threads;

    $scope.nojsstyle = 'display: none';
});

}());

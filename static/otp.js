(function(){'use strict';

// Helpers.
var log = window.log = console.log;
function foreach(array, func, thisarg){
    if(thisarg) func = func.bind(thisarg);
    for(var idx = 0, len = array.length; idx < len; idx++){
        if(func(array[idx], idx) === false) break;
    }
}
function map(array, func, thisarg){
    var results = [];
    foreach(array, function(item){
        var result = func(item);
        if(typeof result !== 'undefined') results.push(result);
    }, thisarg);
    return results;
};

// Link a secret to its relatives.
function linksecret(secret, secrets){
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
    return [secret, secrets];
}

// Recursively gather thread IDs from root and pool of secrets.
function gatherchildren(secret){
    var ids = [secret.id];
    foreach(secret.children, function(child){
        if(typeof child.body === 'undefined') return;
        if(child.authparentids[0] !== secret.id) return;
        // TODO test for personal viewers insertion.
        ids = ids.concat(gatherchildren(child));
    });
    return ids;
}

angular.module('otp', []).controller('secrets', function($scope){

    // Link all the server injected secrets.
    for(var id in secrets){
        linksecret(secrets[id], secrets);
    }

    // Seperate threads.
    var ids = map(Object.keys(secrets), function(key){
        return parseInt(key, 10);
    }).sort(function(a, b){return a - b;});
    var threadids;
    while(ids.length > 0){
        threadids = gatherchildren(secrets[ids[0]]);
        foreach(threadids, function(id){
            var pos = ids.indexOf(id);
            if(pos > -1) ids.splice(pos, 1);
        });
        log(threadids);
    }
    window.s = $scope.secrets = secrets;
    window.t = $scope.threads = threadsecrets($scope.secrets);

    $scope.nojsstyle = 'display: none';
});

}());

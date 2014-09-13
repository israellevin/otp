(function(){'use strict';

// Helpers.
var log = console.log;
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

// Index, sort and link the server injected secrets.
function indexsecrets(rawsecrets){
    var secrets = {viewedids: [], unviewedids: []};
    foreach(rawsecrets, function(secret){
        secrets[secret.id] = secret;
        if(typeof secret.body === 'string') secrets.viewedids.push(secret.id);
        else secrets.unviewedids.push(secret.id);

        if(secret.parentid) secret.parent = secrets[secret.parentid];
        secret.children = map(secret.childids, function(childid){
            return secrets[childid];
        });
    });
    return secrets
}

// Recursively gather IDs of viewed children with continuous auth.
function withchildren(secret){
    return [secret.id].concat(map(secret.children, function(child){
        if(
            typeof child.body === 'string' &&
            child.viewers.every(function(_, secretid){
                return secretid < secret.id;
            })
        ) return withchildren(child);
    }));
}

// Organize secrets in threads.
function threadsecrets(secrets){
    var threads = [];
    var ids = secrets.viewedids.slice();
    while(ids.length > 0){
        threads.push(withchildren(secrets[ids[0]]));
        foreach(ids, function(id){
            var pos = ids.indexOf(id);
            if(pos > -1) ids.splice(pos, 1);
        });
    }
    return threads;
}

angular.module('otp', []).controller('secrets', function($scope){
    $scope.secrets = indexsecrets(rawsecrets);
    $scope.threads = threadsecrets($scope.secrets);

    $scope.nojsstyle = 'display: none';
});

}());

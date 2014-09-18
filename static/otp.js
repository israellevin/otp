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
function eachval(dictionary, func, thisarg){
    each(Object.keys(dictionary), function(key){
        return func(dictionary[key]);
    }, thisarg);
}

// Helpers.
function copy(obj, extension){
    var copy = obj.constructor();
    for(var attr in obj){
        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
    }
    if(typeof extension === 'object') for(var attr in extension){
        if (extension.hasOwnProperty(attr)) copy[attr] = extension[attr];
    }
    return copy;
}

// Link all the server injected secrets to their relatives.
function linksecrets(rawsecrets, viewers){
    var secrets = copy(rawsecrets);
    eachval(secrets, function(secret){
        if(typeof secret.parentid === 'number')
            secret.parent = secrets[secret.parentid];

        var idlinker = map(
            ['childid', 'authparentid', 'authchildid'],
            function(key){
                return map(secret[key + 's'], function(id){return secrets[id];});
            }
        );
        secret.children = idlinker[0];
        secret.authparents = idlinker[1];
        secret.authchildren = idlinker[2];

        secret.author = viewers[secret.authorid];
        each(Object.keys(secret.viewers), function(key){
            secret.viewers[key] = map(secret.viewers[key], function(id){
                return viewers[id];
            });
        });
    });

    return secrets;
}

// Recursively gather a thread of secrets from a root secret.
function threadsecrets(secret){
    if(typeof secret.body === 'undefined') return [];
    var members = [secret];
    each(secret.children, function(child){
        if(
            child.authparentids[0] !== secret.id || child.authparentids.length > 1 || (
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

    this.viewed = this.members.every(function(member){
        return typeof member.body === 'string';
    });

    try{
        this.name = this.members[0].body.match(/^[^\n]{0,20}($|[\n\s])/)[0];
    }catch(e if e instanceof TypeError){
        this.name = this.members[0].body.slice(0,20);
    }

    var viewers = []
    eachval(this.members[0].viewers, function(viewerids){
        each(viewerids, function(viewerid){
            if(viewers.indexOf(viewerid) < 0) viewers.push(viewerid);
        });
    });
    this.viewers = viewers;
}

// Work that angulaJS magic.
angular.module('otp', []).controller('secrets', function($scope){

    // Both rawsecrets and rawviewers are injected to window by flask.
    var secrets = window.s = linksecrets(rawsecrets, rawviewers);
    var threads = window.t = []

    // Pull threads off checklist till we run out of unthreaded secrets.
    var members, checklist = map(Object.keys(secrets), function(key){
        return parseInt(key, 10);
    }).sort(function(a, b){return a - b;});
    while(checklist.length > 0){
        members = threadsecrets(secrets[checklist[0]]);
        if(members.length === 0){
            // TODO handle unviewed.
            checklist.shift();
            continue;
        }
        threads.unshift(new Thread(members));

        each(members, function(member){
            var pos = checklist.indexOf(member.id);
            if(pos > -1) checklist.splice(pos, 1);
        });
    }
    

    $scope.secrets = secrets;
    $scope.threads = threads;

    /*$scope.showThreadSecrets(thread){
        log(thread);
    }*/
    $scope.nojsstyle = 'display: none';
}).controller('composer', function($scope, $http){

    $scope.authparents = [];
    $scope.addauthparent = function(){
        $scope.authparents.push($scope.authparentid);
    };

    $scope.authchildren = [];
    $scope.addauthchild = function(){
        $scope.authchildren.push($scope.authchildid);
    };

    $scope.viewers = [];
    $scope.addviewer = function(){
        $scope.viewers.push($scope.viewerid);
    };

    $scope.post = function(){
        $http({
            url: 'post',
            method: 'post',
            params: {
                body: $scope.body,
                parentid: $scope.parentid,
                'authparentids[]': $scope.authparents,
                'authchildids[]': $scope.authchildren,
                'viewerids[]': $scope.viewers

            }
        }).success(function(data){
            console.log('gotit', arguments);
        }).error(function(data){
            console.log('error 666:', arguments);
        });
    };
});

}());

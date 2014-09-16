#!/usr/bin/python3

import db

from werkzeug.exceptions import BadRequest
from flask import(
        Flask,
        abort,
        current_app,
        flash,
        g,
        get_flashed_messages,
        json,
        make_response,
        redirect,
        render_template,
        request,
        session,
        url_for,
)
app = Flask(__name__)
app.config.update(
    SECRET_KEY = 'OTP',
    DEBUG = True
)

from flask_login import(
    LoginManager,
    login_required,
    login_user,
    logout_user,
    current_user
)
loginmanager = LoginManager()
loginmanager.init_app(app)
loginmanager.login_view = 'login'
@loginmanager.user_loader
def load_user(userid):
    return db.Viewer.getbyid(userid)

@app.route('/login', methods=['GET', 'POST'])
def login():
    logout_user()
    session.clear()
    if not 'passphrase' in request.args:
        return render_template('login.html')
    if 'name' in request.args:
        user = db.Viewer(request.args['name'], request.args['passphrase'])
    else:
        user = db.Viewer.getbypass(request.args['passphrase'])
    if user is None:
        flash('New user')
        return render_template('login.html')
    try: login_user(user)
    except AttributeError: flash('Bad login')
    return redirect(request.args.get('next', url_for('index')))

def jsonablesecret(view):
    secret = view.secret
    jsonable = {
        'id': secret.id,
        'time': secret.time,
        'authorid': secret.authorid,
        'parentid': secret.parentid,
        'childids': [child.id for child in secret.children],
        'authparentids': [authparent.id for authparent in secret.authparents],
        'authchildids': [authchild.id for authchild in secret.authchildren],
        'viewers': {
            group: [viewer.id for viewer in viewers]
            for group, viewers in secret.knownviewers(current_user).items()
        }
    }
    if view.viewed: jsonable['body'] = secret.body
    return jsonable

@app.route('/')
@login_required
def index():
    return render_template('index.html', viewers=db.Viewer.getall(), secrets={
        view.secretid: jsonablesecret(view) for view in current_user.views
    })

from functools import wraps
def jsonp(f):
    @wraps(f)
    def wraped(*args, **kwargs):
        data = json.dumps(f(*args, **kwargs), indent=4)
        mimetype = 'application/'
        try:
            data = "%s(%s)" % (request.values['callback'], data)
            mimetype += 'javascript'
        except BadRequest as e:
            mimetype += 'json'
        return current_app.response_class(data, mimetype=mimetype)
    return wraped

@app.route('/secret', methods=['GET', 'POST'])
@login_required
@jsonp
def getsecret():
    view = db.View.get(current_user.id, request.args['id'], False, False, True)
    if not view: return {'error': 'unauthorized'}
    return jsonablesecret(view)

@app.route('/post', methods=['GET', 'POST'])
@login_required
@jsonp
def postsecret():
    return {
        'posttime':
            db.Secret(
                request.args.get('body'),
                current_user.id,
                request.args.get('parentid'),
                request.args.getlist('viewerids[]'),
                request.args.getlist('authparentids[]'),
                request.args.getlist('authchildids[]')
            ).time
    }

if __name__ == '__main__':
    app.run(host='0.0.0.0')

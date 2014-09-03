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
    if not 'passphrase' in request.args:
        return ''.join([
            "<div>%s</div>" % message for message in get_flashed_messages()
        ]) + '''
            <form>
                <input name=passphrase autofocus>
                <input name=next type=hidden value="%s">
            </form>
        ''' % (request.args.get('next') or '',)
    if 'name' in request.args:
        user = db.Viewer(request.args['name'], request.args['passphrase'])
    else:
        user = db.Viewer.getbypass(request.args['passphrase'])
    if user is None:
        flash('New user')
        return ''.join([
            "<div>%s</div>" % message for message in get_flashed_messages()
        ]) + '''
            <form>
                <input name=name autofocus>
                <input name=passphrase type=hidden value="%s">
                <input name=next type=hidden value="%s">
            </form>
        ''' % (request.args['passphrase'], request.args.get('next') or '')
    try: login_user(user)
    except AttributeError: flash('Bad login')
    return redirect(request.args.get('next') or url_for('index'))

@app.route('/logout')
def logout():
    logout_user()
    session.clear()
    return redirect(request.args.get('next') or url_for('index'))

def jsonablesecret(view):
    secret = view.secret
    jsonable = {
        'id': secret.id,
        'name': secret.name,
        'time': secret.time,
        'authorid': secret.authorid,
        'parentid': secret.parentid,
        'childids': [child.id for child in secret.children],
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
    return render_template('index.html', viewers=db.Viewer.getall(), secrets=[
        jsonablesecret(view) for view in current_user.views
    ])

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
    # Fake a secret from ID.
    secret = type('', (), {'id': request.args['id']})
    view = db.View.get(secret, current_user, False, False, True)
    if not view: return {'error': 'unauthorized'}
    return jsonablesecret(view)

@app.route('/secret', methods=['GET', 'POST'])
@login_required
@jsonp
def postsecret():
    return Secret(
        request.args['name'],
        request.args['body'],
        current_user,
        None,
        [us[0]]
    ).time
    return True

if __name__ == '__main__':
    app.run(host='0.0.0.0')

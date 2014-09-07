#!/usr/bin/python3

# Default local db for testing, set the env variable to override.
dbfilename = 'otp.db'
dbscheme = 'sqlite'
from os import environ
dburl = environ.get('DATABASE_URL', "%s:///%s" % (dbscheme, dbfilename))

from sqlalchemy import create_engine, event
from sqlalchemy.orm import scoped_session, sessionmaker, mapper
engine = create_engine(dburl)
session = scoped_session(sessionmaker(bind = engine))
@event.listens_for(mapper, 'init')
def auto_add(target, args, kwargs):
    session.add(target)

from sqlalchemy.ext.declarative import declarative_base
Base = declarative_base()
Base.query = session.query_property()

from sqlalchemy import(
    Table,
    Column,
    Integer,
    String,
    Boolean,
    ForeignKey,
    exc
)
from sqlalchemy.types import UnicodeText, DateTime, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime

from flask_login import UserMixin
from hashlib import sha256
SALT = 'salt, but it sure tastes good'
class Viewer(Base, UserMixin):
    __tablename__ = 'viewers'
    id = Column(Integer, primary_key=True)
    passphrasehash = Column(String, unique=True)
    name = Column(String(64))
    lastseen = Column(DateTime)

    def __init__(self, name, passphrase):
        self.name = name
        self.passphrasehash = sha256(str.encode(
            SALT + passphrase
        )).hexdigest()
        self.lastseen = datetime.now()
        session.flush()

    def __repr__(self):
        return 'u:' + self.name

    @classmethod
    def getbyid(cls, id):
        try: return session.query(cls).filter_by(id=id).one()
        except exc.SQLAlchemyError: return None

    @classmethod
    def getbypass(cls, passphrase):
        try: return session.query(cls).filter_by(
            passphrasehash=sha256(str.encode(
                SALT + passphrase
            )).hexdigest()
        ).one()
        except exc.SQLAlchemyError: return None

    @classmethod
    def getall(cls):
        try: return session.query(cls.id, cls.name, cls.lastseen).all()
        except exc.SQLAlchemyError: return None

class View(Base):
    __tablename__ = 'views'
    id = Column(Integer, primary_key=True)
    viewerid = Column(Integer, ForeignKey('viewers.id'))
    secretid = Column(Integer, ForeignKey('secrets.id'))
    personal = Column(Boolean)
    viewed = Column(DateTime)

    viewer = relationship('Viewer', backref='views')
    secret = relationship('Secret', backref='views')

    def __init__(self, viewerid, secretid):
        self.viewerid ,self.secretid = viewerid, secretid
        session.flush()

    def __repr__(self):
        return "v:%s->%s" % (self.viewer.name, self.secret.name)

    @classmethod
    def get(cls, viewerid, secretid, create=None, personal=None, viewed=None):
        try:
            view = session.query(cls).filter_by(
                secretid=secretid, viewerid=viewerid
            ).one()
        except exc.SQLAlchemyError:
            if not create:
                return False
            else:
                view = cls(viewerid, secretid)

        if personal is not None: view.personal = personal
        if type(viewed) is datetime: view.viewed = viewed
        elif viewed is not None: view.viewed = datetime.now()
        if None not in (personal, viewed): session.flush()
        return view

class Revelation(Base):
    __tablename__ = 'revelations'
    id = Column(Integer, primary_key=True)
    revealedid = Column(Integer, ForeignKey('secrets.id'))
    revealerid = Column(Integer, ForeignKey('secrets.id'))
    public = Column(Boolean, default=False)

    def __init__(self, revealed, revealer, public=None):
        self.revealedid, self.revealerid = revealed.id, revealer.id
        if public is not None: self.public = public
        revealed.reveal(revealer.viewers)

    def __repr__(self):
        return "r:%s->%s" % (self.revealer.name, self.revealed.name)

class Secret(Base):
    __tablename__ = 'secrets'
    id = Column(Integer, primary_key=True)
    time = Column(DateTime)
    name = Column(String(256))
    body = Column(UnicodeText)

    authorid = Column(Integer, ForeignKey('viewers.id'))
    parentid = Column(Integer, ForeignKey('secrets.id'))

    author = relationship('Viewer')
    parent = relationship('Secret', remote_side=[id], backref='children')
    viewers = relationship('Viewer', secondary='views', backref='secrets')
    personalviewers = relationship(
        'Viewer',
        secondary='views',
        primaryjoin='''and_(
            Secret.id == View.secretid,
            View.personal == True
        )'''
    )
    authparents = relationship(
        'Secret',
        secondary='revelations',
        primaryjoin=id==Revelation.revealedid,
        secondaryjoin=id==Revelation.revealerid,
        backref='authchildren'
    )
    publicauthparents = relationship(
        'Secret',
        secondary='revelations',
        primaryjoin='''and_(
            Secret.id == Revelation.revealedid,
            Revelation.public == True
        )''',
        secondaryjoin=id==Revelation.revealerid
    )
    privateauthparents = relationship(
        'Secret',
        secondary='revelations',
        primaryjoin='''and_(
            Secret.id == Revelation.revealedid,
            Revelation.public == False
        )''',
        secondaryjoin=id==Revelation.revealerid
    )

    def __init__(
        self, name, body, authorid,
        parentid=None, viewerids=[], authparentids=[], authchildrenids=[]
    ):
        self.time = datetime.now()
        self.name, self.body = name, body
        self.authorid = authorid
        if parentid is not None: self.parentid = parentid
        session.flush()

        View.get(authorid, self.id, True, True, self.time)
        for viewerid in viewerids:
            View.get(viewerid, self.id, True, True)
        for secretid in authparentids:
            Revelation(self, Secret.getbyid(secretid), True)
        for secretid in authchildrenids:
            Revelation(Secret.getbyid(secretid), self)
        session.commit()

    def __repr__(self):
        return 's:' + self.name

    def reveal(self, viewers):
        for viewer in viewers:
            View.get(viewer.id, self.id, True)
        for child in self.authchildren: child.reveal(viewers)
        session.flush()

    def knownviewers(self, viewer, ignore=None):
        if ignore is None: ignore = []
        elif self in ignore: return []
        ignore.append(self)
        viewers = {self.id: self.personalviewers[:]}
        for secret in self.publicauthparents:
            viewers.update(secret.knownviewers(viewer, ignore))
        for secret in self.privateauthparents:
            if viewer in secret.viewers:
                viewers.update(secret.knownviewers(viewer, ignore))
        return viewers

    @classmethod
    def getbyid(cls, id):
        try: return session.query(cls).filter_by(id=id).one()
        except exc.SQLAlchemyError: return None

if __name__ == '__main__':

    from os.path import isfile
    if isfile(dbfilename):
        if 'y' != input('Delete database and create a new one? (y/N): '):
            from sys import exit
            exit(0)
        from os import remove
        remove(dbfilename)

    Base.metadata.create_all(bind=engine)
    us = []
    us.append(Viewer('israel', '1'))
    us.append(Viewer('ghoula', '2'))
    us.append(Viewer('xbu', '3'))
    us.append(Viewer('xao', '4'))
    ss = []
    ss.append(Secret('private from i to g', 'actual content', us[0].id, None, [us[1].id]))
    View.get(us[1].id, ss[0].id, False, True, True)
    ss.append(Secret('g tells xbu about 1', 'not much', us[1].id, ss[0].id, [us[2].id], [], [ss[0].id]))
    ss.append(Secret('g tells xao about 2', 'even less', us[1].id, ss[1].id, [us[3].id], [], [ss[0].id]))
    ss.append(Secret('gs char sheet', 'lesser', us[1].id, None, [us[0].id]))
    ss.append(Secret('stam', 'blam', us[0].id, None, [us[1].id]))
    session.commit()

    for u in us:
        print('User', u.name)
        print()
        for s in u.secrets:
            print(s)
            print(s.knownviewers(u))
            print()
        print()

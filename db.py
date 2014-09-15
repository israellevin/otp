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
        return "u%i:%s" % (self.id, self.name)

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

    def __init__(self, revealed, revealer):
        self.revealedid, self.revealerid = revealed.id, revealer.id
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

    def __init__(
        self, name, body, authorid,
        parentid=None, viewerids=[], authparentids=[], authchildids=[]
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
            Revelation(self, Secret.getbyid(secretid))
        for secretid in authchildids:
            Revelation(Secret.getbyid(secretid), self)
        session.commit()

    def __repr__(self):
        return "s%i:%s" % (self.id, self.name)

    def reveal(self, viewers):
        for viewer in viewers:
            View.get(viewer.id, self.id, True)
        for child in self.authchildren: child.reveal(viewers)
        session.flush()


    def knownviewers(self, viewer, ignore=None, lastauth=None):
        viewers = {}
        if ignore is None: ignore = [self]
        else:
            if self in ignore: return viewers
            ignore.append(self)

        if View.get(viewer.id, self.id): lastauth = self
        elif lastauth is None: return viewers

        if(len(self.personalviewers) > 1):
            viewers[lastauth.id] = set(self.personalviewers)

        for authparent in self.authparents:
            if (
                (authparent.id < self.id) or
                (authparent.id > self.id and viewer in authparent.viewers)
            ):
                for secretid, viewerlist in authparent.knownviewers(
                    viewer, ignore, lastauth
                ).items():
                    viewers[secretid] = (
                        viewerlist.union(viewers[secretid])
                        if secretid in viewers else viewerlist
                    )
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
    us.append(Viewer('ruby', '0'))
    us.append(Viewer('benedict', '1'))
    us.append(Viewer('bleys', '2'))
    us.append(Viewer('tauv', '3'))
    ss = []
    # 0
    ss.append(Secret('in the library', 'ruby is searching for benedict', us[0].id,
        parentid=None, viewerids=[us[1].id], authparentids=[], authchildids=[]))
    View.get(us[1].id, ss[0].id, False, None, True)
    # 1
    ss.append(Secret('talking in the library', 'hi ruby, what do you want?', us[1].id,
        parentid=ss[0].id, viewerids=[], authparentids=[ss[0].id], authchildids=[]))
    View.get(us[0].id, ss[1].id, False, None, True)
    # 2
    ss.append(Secret('confession', 'just wanted to tell you that I love honey', us[0].id,
        parentid=ss[1].id, viewerids=[], authparentids=[ss[1].id], authchildids=[]))
    View.get(us[1].id, ss[2].id, False, None, True)
    # 3
    ss.append(Secret('pretence', 'how nice of you!', us[1].id,
        parentid=ss[2].id, viewerids=[], authparentids=[ss[2].id], authchildids=[]))
    View.get(us[0].id, ss[3].id, False, None, True)

    # 4
    ss.append(Secret('betrayal', 'benedict rushes to bleys and schtinks', us[1].id,
        parentid=ss[2].id, viewerids=[us[2].id], authparentids=[], authchildids=[ss[2].id]))
    View.get(us[2].id, ss[2].id, False, None, True)
    View.get(us[2].id, ss[3].id, False, None, True)
    View.get(us[2].id, ss[4].id, False, None, True)

    session.commit()

    for u in us:
        print('User', u.name)
        print()
        for s in u.secrets:
            print(s)
            print(s.knownviewers(u))
            print()
        print()

#!/usr/bin/env python3

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
epoc = datetime(1970,1,1)
def jsontime(time): return (time - epoc).total_seconds()

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
        self.lastseen = datetime.utcnow()
        session.commit()

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
    def getall(cls, lastupdate=None):
        try: viewers = session.query(cls.id, cls.name, cls.lastseen).all()
        except exc.SQLAlchemyError: return []
        if lastupdate is not None:
            # JavaScript consistently loses a microsecond.
            lastupdate = datetime.utcfromtimestamp(float(lastupdate) + 0.000001)
            viewers = filter(lambda x: x.lastseen > lastupdate, viewers)
        return [
            {
                'id': viewer[0],
                'name': viewer[1],
                'lastseen': jsontime(viewer[2])
            } for viewer in viewers
        ]

class View(Base):
    __tablename__ = 'views'
    id = Column(Integer, primary_key=True)
    viewerid = Column(Integer, ForeignKey('viewers.id'))
    secretid = Column(Integer, ForeignKey('secrets.id'))
    personal = Column(Boolean)
    viewed = Column(DateTime)

    viewer = relationship('Viewer', backref='views')
    secret = relationship('Secret', backref='views')

    def __init__(self, viewerid, secretid, personal):
        self.viewerid ,self.secretid, self.personal = (
            viewerid, secretid, personal
        )
        session.commit()

    def __repr__(self):
        return "v:%s->%i" % (self.viewer.name, self.secret.id)

    @classmethod
    def get(cls, viewerid, secretid, createmode=None, viewed=None):
        try:
            view = session.query(cls).filter_by(
                secretid=secretid, viewerid=viewerid
            ).one()
        except exc.SQLAlchemyError:
            if createmode is None:
                return False
            else:
                view = cls(viewerid, secretid, createmode)

        if viewed is not None:
            if type(viewed) is datetime: view.viewed = viewed
            else: view.viewed = datetime.utcnow()
            view.viewer.lastseen = view.viewed
            session.commit()
        return view

class Revelation(Base):
    __tablename__ = 'revelations'
    id = Column(Integer, primary_key=True)
    revealedid = Column(Integer, ForeignKey('secrets.id'))
    revealerid = Column(Integer, ForeignKey('secrets.id'))

    def __init__(self, revealed, revealer):
        self.revealedid, self.revealerid = revealed.id, revealer.id
        revealed.reveal(revealer.viewers)
        session.commit()

    def __repr__(self):
        return "r:%i->%i" % (self.revealer.id, self.revealed.id)

class Secret(Base):
    __tablename__ = 'secrets'
    id = Column(Integer, primary_key=True)
    time = Column(DateTime, nullable=False)
    body = Column(UnicodeText, nullable=False)

    authorid = Column(Integer, ForeignKey('viewers.id'), nullable=False)
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
        self, body, authorid,
        parentid=None, viewerids=[], authparentids=[], authchildids=[]
    ):
        self.time = datetime.utcnow()
        self.body, self.authorid = body, authorid
        if parentid is not None: self.parentid = parentid
        session.flush()

        View.get(authorid, self.id, True, self.time)
        for viewerid in viewerids:
            View.get(viewerid, self.id, True)
        for secretid in authparentids:
            Revelation(self, Secret.getbyid(secretid))
        for secretid in authchildids:
            Revelation(Secret.getbyid(secretid), self)
        session.commit()

    def __repr__(self):
        return "s%i:%s" % (self.id, self.body[:20])

    def reveal(self, viewers):
        for viewer in viewers:
            View.get(viewer.id, self.id, False)
        for child in self.authchildren: child.reveal(viewers)

    def knownviewers(self, viewer, ignore=None, lastauth=None, proxy=None):
        viewers = {}
        if ignore is None: ignore = [self]
        elif self in ignore: return viewers
        else:
            if len(ignore) == 1: proxy = self
            ignore.append(self)

        view = View.get(viewer.id, self.id)
        if View: lastauth = self
        viewers[lastauth.id if proxy is None else proxy.id] = set(
            self.personalviewers
        )

        for authparent in self.authparents:
            if (
                (authparent.id < self.id) or
                (authparent.id > self.id and viewer in authparent.viewers)
            ):
                for secretid, viewerlist in authparent.knownviewers(
                    viewer, ignore, lastauth, proxy
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

    @classmethod
    def latestid(cls):
        return session.query(cls).count()

if __name__ == '__main__':
    Base.metadata.create_all(bind=engine)

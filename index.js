require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const {Pool} = require("pg");
const bcrypt = require("bcrypt");
const saltRounds = 10;


//Set up postgreSQL database and create new client
const client = new Pool({
    user: process.env.USER,
    password: process.env.PASSWORD,
    host: process.env.HOST,
    port: process.env.PORT,
    database: process.env.DATABASE,
    ssl: { rejectUnauthorized: false }
});


client.connect(err => {
    if(err){
        console.log("Connection err: " + err.stack);
    } else {
        console.log("Connected");
    }
});

// set up app withexpress
app = express();

// set up various items
app.use(bodyParser.urlencoded({extended:true}));
app.use(express.static(__dirname + '/public'));
app.set("view engine", "ejs");



app.use(session({
    store: new (require('connect-pg-simple')(session))({
        pool: client
    }),
    cookie: {maxAge:86400000},
    secret: process.env.SESSION_KEY,
    resave: false,
    saveUninitialized: false,
    proxy: true
}));


app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(function (username, pass, done) {
    client.query("SELECT * FROM users WHERE username=$1", [username], (err, result) => {
        console.log(result.rows);
        if(typeof result.rows !== "undefined" || result.rows.length > 0){
            const user = result.rows[0];
            bcrypt.compare(pass, user.password, (err, res) => {
                if(res){
                    done(null, user);
                } else {
                    done(null, false);
                }
            })
        } else {
            done(null, false);
        }
    });
}));

passport.serializeUser(function(user, done) {
    done(null, user);
  });
  
passport.deserializeUser(function(id, done) {
    done(null, id);
});


// routes for home page
app.get("/", (req,res) => {
    if(req.isAuthenticated()){
        client.query("SELECT post_id, title, content, username, (SELECT COUNT(*) FROM likes WHERE likes.post_id=posts.post_id) AS totalLikes \
            FROM posts INNER JOIN users ON users.user_id= posts.user_id ORDER BY posts.post_id DESC", (err, results) => {
            if(err){
                console.log(err);
                res.redirect("/login");
            } else {
                res.render("index", {isLoggedIn: true, posts:results, req:req});
            }
        });
    } else {
        res.redirect("/login");
    }
});


//routes for logging in to the blog site
app.get("/login", (req,res) => {
    if(req.isAuthenticated()){
        res.redirect("/");
    } else {
        res.render("login", {isLoggedIn:false, req:req});
    }
   
});

app.post("/login", passport.authenticate("local"), (req, res) => {
    res.redirect("/");
});


//routes for creating an account for the blog site
app.get("/register", (req,res) => {
    if(req.isAuthenticated()){
        res.redirect("/");
    } else {
        res.render("register", {isLoggedIn:false});
    }
});


app.post("/register", (req,res) => {
    const user = req.body.username;
    const pass = req.body.password;
    const pass2 = req.body.password_confirm;
    if(pass === pass2){
        client.query("SELECT * FROM users WHERE username=$1", [user], (err,result) => {
            if(err){
                console.log(err);
                res.redirect("/register");
            } 
            if (typeof result.rows == "undefined" || result.rows.length > 0){
                res.redirect("/register");
            } else {
                bcrypt.hash(pass, saltRounds, (err,hash) => {
                    if(err){
                        console.log(err);
                        res.redirect("/register");   
                    } else {
                        client.query("INSERT INTO users (username, password) VALUES ($1, $2)", [user, hash], (err,result) => {
                            if(err){
                                console.log(err);
                                res.redirect("/register");
                            } else {
                                res.redirect("/login");
                            }
                        });
                    }
                });   
            }
        });
    } else {
        res.redirect("/register");
    }
});


//route for logging out
app.get("/logout", (req,res) => {
    req.logout();
    res.redirect("/login");
});


//routes for viewing individual blog posts
app.get("/blog/:id", (req,res) => {
    if(req.isAuthenticated()){
        const id = req.params.id;
        client.query("SELECT post_id, title, content, username, (SELECT COUNT(*) FROM likes WHERE likes.post_id=posts.post_id) AS totalLikes FROM posts \
                INNER JOIN users ON users.user_id= posts.user_id WHERE post_id=$1", [id], (err, result) => {
            if(err){
                console.log(err);
                res.redirect("/");
            } else {
                client.query("SELECT username, comment FROM users INNER JOIN comments ON users.user_id=comments.user_id WHERE post_id=$1", [id], (err, results) => {
                    if(err){
                        console.log(err);
                        res.redirect("/blog/" +id);
                    } else {
                        client.query("SELECT * FROM likes WHERE post_id=$1", [id], (err, likeAmounts) => {
                            if(err){
                                console.log(err);
                            } else {
                                var isLiked = false;
                                var indexReturned = likeAmounts.rows.findIndex( (post,index) => {
                                    if(post.user_id === req.user.user_id){
                                        return true;
                                    }
                                });

                                if(indexReturned >= 0){
                                    isLiked = true;
                                }
                                res.render("blog", {post:result.rows[0], isLoggedIn:true, req:req, comments:results.rows, likes:likeAmounts, isLiked:isLiked});
                            }
                        });
                        
                    }
                })
            }
        });
    } else {
        res.redirect("/login");
    }
});


// route for deleting a blog post
app.post("/delete/:id", (req,res) => {
    const postId = req.params.id;
    client.query("DELETE FROM posts WHERE post_id=$1", [postId], (err, result) => {
        if(err){
            console.log(err);
            res.redirect("/blog/" +postId);
        } else {
            res.redirect("/");
        }
    })
});


// routes for composing posts
app.get("/compose", (req,res) => {
    if(req.isAuthenticated()){
        res.render("compose", {isLoggedIn:true, req:req});
    } else {
        res.redirect("/login");
    }
});


app.post("/compose", (req, res) => {
    if(req.isAuthenticated()){
        const title = req.body.title;
        const content = req.body.content;
        client.query("INSERT INTO posts (title, content, user_id) VALUES ($1, $2, $3)", [title, content, req.user.user_id], (err, result) => {
            if(err){
                console.log(err);
                res.redirect("/compose");
            } else {
                res.redirect("/");
            }
        });
    } else {
        res.redirect("/login");
    }
});


app.post("/comment", (req, res) => {
    if(req.isAuthenticated()){
        const comment = req.body.comment_text;
        const user_id = req.user.user_id;
        const post_id = req.body.post_id;
        client.query("INSERT INTO comments (comment, user_id, post_id) VALUES ($1, $2, $3)", [comment, user_id, post_id], (err, results) => {
            if(err){
                console.log(err);
                res.redirect("/");
            } else {
                res.redirect("/blog/" + post_id);
            }
        });
    }
});


app.post("/like/:id", (req, res) => {
    if(req.isAuthenticated()){
        const post_id = req.params.id;
        const user_id = req.user.user_id;
        client.query("INSERT INTO likes (user_id, post_id) VALUES ($1, $2)", [user_id, post_id], (err, result) => {
            if(err){
                console.log(err);
                res.redirect("/blog/" + post_id);
            } else {
                res.redirect("/blog/" + post_id);
            }
        });
    } else {
        res.redirect("/login");
    }
});


app.post("/removelike/:id", (req,res) => {
    if(req.isAuthenticated()){
        const post_id = req.params.id;
        const user_id = req.user.user_id;
        client.query("DELETE FROM likes WHERE user_id=$1 AND post_id=$2", [user_id, post_id], (err, result) => {
            if(err){
                console.log(err);
                res.redirect("/blog/" +post_id);
            } else {
                res.redirect("/blog/" +post_id);
            }
        });
    } else {
        res.redirect("/login");
    }
});


// starts the server on port 3000 or Heroku's port
let port = process.env.PORT;
if(port == null || port ==""){
    port = 3000;
}


app.listen(port, () => {
    console.log("Server has started successfully.");
});
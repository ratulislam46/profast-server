const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());



// token verify from firebase 
const serviceAccount = require('./firebase_admin_key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ibgq1ve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const allParcelsCollection = client.db('profast').collection('parcels');
        const paymentCollection = client.db('profast').collection('payments');
        const usersCollection = client.db('profast').collection('users');
        const ridersCollection = client.db('profast').collection('riders');

        const verifyFBToken = async (req, res, next) => {
            // console.log('header in middleware', req.headers);

            const authHeaders = req.headers.authorization;
            if (!authHeaders) {
                res.status(401).send({ message: 'Unauthorization access' });
            }
            const token = authHeaders.split(' ')[1];
            if (!token) {
                res.status(401).send({ message: 'Unauthorization access' });
            }
            //verify token 
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
            }
            catch (error) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email });
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }


        // get all parcel in database
        app.get('/parcels', async (req, res) => {
            const data = req.body;
            const result = await allParcelsCollection.find(data).toArray();
            res.send(result)
        })

        // particular user get his api 
        app.get('/parcels', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            try {
                const query = email ? { created_by: email } : {};
                const options = { sort: { createdAt: -1 } }
                const parcels = await allParcelsCollection.find(query, options).toArray();
                res.json(parcels);
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // post parcel in daatbase 
        app.post('/parcels', async (req, res) => {
            const user = req.body;
            const result = await allParcelsCollection.insertOne(user)
            res.send(result)
        })

        // get specific parcel by id 
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const parcel = await allParcelsCollection.findOne({ _id: new ObjectId(id) });
                if (!parcel) {
                    return res.status(404).send({ message: 'Parcel not found' })
                }
                res.send(parcel)
            }
            catch (error) {
                console.error('Error fetching parcel:', error);
                res.status(500).send({ message: 'Failed to fetch params ' })
            }
        })

        // users search 
        app.get('/users/search', async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: 'missing email query' });
            }
            // const regex = new RegExp(emailQuery, 'i');
            try {
                const users = await usersCollection.find({ email: { $regex: emailQuery, $options: 'i' } }).toArray();
                res.send(users)
            }
            catch (error) {
                res.status(500).send({ message: 'Error searching users' })
            }
        })

        // user role get for admin/users
        app.get('/users/role/:email', async (req, res) => {
            const email = req.params.email;
            if (!email) {
                res.status(400).send({ message: "Email is required" })
            }
            const user = await usersCollection.findOne({ email })
            if (!user) {
                res.status(404).send({ message: "User can't find " })
            }
            res.send(user)
        })

        // users patch for make admin 
        app.patch('/users/admin/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;
            const query = { _id: new ObjectId(id) };
            const updateDoc = { $set: { role } }
            try {
                const result = await usersCollection.updateOne(query, updateDoc);
                res.send(result)
            }
            catch (error) {
                res.status(500).send({ message: 'User admin related error' })
            }
        })

        //users post in datbase
        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExist = await usersCollection.findOne({ email });
            if (userExist) {
                return res.status(200).send({ message: 'User already exists' });
            }
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        // specific parcel delete 
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const data = { _id: new ObjectId(id) }
                const result = await allParcelsCollection.deleteOne(data);
                res.send(result);
            } catch (err) {
                res.status(500).json({ message: err.message });
            }
        });

        // custom card parcel peyment system 
        app.post('/create-payment-intent', async (req, res) => {
            const ammoutCents = req.body.ammoutCents;
            try {
                const { amount } = req.body;
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: ammoutCents,
                    currency: 'usd',
                    payment_method_types: ['card']
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // payments get 
        app.get('/payments', verifyFBToken, async (req, res) => {
            const userEmail = req.query.email;

            // console.log(req.headers.authorization);

            // console.log('decoded', req.decoded);
            if (req.decoded.email !== userEmail) {
                return res.status(403).send({ message: 'forbidden access' })
            }


            const query = userEmail ? { email: userEmail } : {};
            const options = { sort: { paid_at: -1 } };
            const result = await paymentCollection.find(query, options).toArray();
            res.send(result)
        })

        // payment post 
        app.post('/payments', async (req, res) => {
            try {
                const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

                const query = { _id: new ObjectId(parcelId) };
                const updateDoc = { $set: { payment_status: 'paid' } }
                const updateResult = await allParcelsCollection.updateOne(query, updateDoc);
                if (updateResult.modifiedCount === 0) {
                    return res.status(404).send({ message: 'parcel already paid' })
                }

                const paymentDoc = {
                    parcelId, email, amount, paymentMethod, transactionId,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date()
                }
                const paymentResult = await paymentCollection.insertOne(paymentDoc);
                res.status(201).send({
                    message: 'payment recorded and parcel marked as paid',
                    insertedId: paymentResult.insertedId
                })
            }
            catch (error) {
                console.error('payment processing failed', error)
            }
        })

        // payment delete 
        app.delete('/payments/:id', async (req, res) => {
            const id = req.params.id;
            const data = { _id: new ObjectId(id) }
            const result = await paymentCollection.deleteOne(data);
            res.send(result)
        })

        // riders pending 
        app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const pendingRiders = await ridersCollection.find({ status: "pending" }).toArray();
                res.send(pendingRiders)
            }
            catch {
                res.status(500).send({ message: 'failed to load pending riders' })
            }
        })

        // riders active 
        app.get('/riders/active', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const approvedRiders = await ridersCollection.find({ status: 'active' }).toArray();
                res.send(approvedRiders)
            }
            catch (error) {
                res.status(500).send({ message: 'Error fetching active riders' })
            }
        })

        //riders patch 
        app.patch('/riders/status/:id', async (req, res) => {
            const id = req.params.id;
            const { status, email } = req.body;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: status }
            }
            try {
                const result = await ridersCollection.updateOne(query, updateDoc);

                // update user role for accepting rider 
                if (status === "active") {
                    const userQuery = { email };
                    const userUpdateDoc = {
                        $set: { status: 'rider' }
                    }
                    const roleResult = await usersCollection.updateOne(userQuery, userUpdateDoc);
                }
                res.send(result)
            }
            catch (error) {
                res.status(500).send({ message: 'error updating rider status', error })
            }
        })

        // riders post 
        app.post('/riders', async (req, res) => {
            const data = req.body;
            const result = await ridersCollection.insertOne(data);
            res.send(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    }
    finally {

    }
}
run().catch(console.dir);



app.get('/', async (req, res) => {
    res.send('parcel servel is runing')
})

// Start server
app.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});

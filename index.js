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
        const verifyRider = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email });
            if (!user || user.role !== 'rider') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        // get all parcel in database
        // app.get('/parcels', async (req, res) => {
        //     const data = req.body;
        //     const result = await allParcelsCollection.find(data).toArray();
        //     res.send(result)
        // })

        // particular user get his api 
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email, payment_status, delivery_status } = req.query;
                let query = {}
                if (email) {
                    query = { created_by: email }
                }
                if (delivery_status) {
                    query.delivery_status = delivery_status
                }
                if (payment_status) {
                    query.payment_status = payment_status
                }
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

        // parcel assign update 
        app.patch("/parcels/:id/assign", async (req, res) => {
            const parcelId = req.params.id;
            const { riderId, riderName, riderEmail } = req.body;
            try {
                // Update parcel
                await allParcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "rider_assigned",
                            assigned_rider_id: riderId,
                            assigned_rider_name: riderName,
                            assigned_rider_email: riderEmail
                        },
                    }
                );
                // Update rider
                await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    {
                        $set: {
                            work_status: "in_delivery",
                        },
                    }
                );
                res.send({ message: "Rider assigned" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to assign rider" });
            }
        });

        // pending delivery_status update in parcels 

        app.patch("/parcels/:id/status", async (req, res) => {
            const parcelId = req.params.id;
            const { status } = req.body;
            const updatedDoc = {
                delivery_status: status
            }
            try {
                const result = await allParcelsCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: updatedDoc
                    }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update status" });
            }
        });

        // riders earn money cashout 
        app.patch('/parcels/cashout/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    cashout_status: 'cash_out',
                    cashout_at: new Date()
                }
            };

            try {
                const result = await allParcelsCollection.updateOne(query, updateDoc);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update parcel cashout' });
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
                return res.status(400).send({ message: "Email is required" })
            }
            const user = await usersCollection.findOne({ email })
            if (!user) {
                return res.status(404).send({ message: "User can't find " })
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
        app.get('/payments', verifyFBToken, verifyAdmin, async (req, res) => {
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

        // 🔹 Find riders on region 
        app.get('/riders', async (req, res) => {
            const region = req.query.region;
            try {
                const result = await ridersCollection.find({ region: region }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch riders.' });
            }
        });

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

        // riders avaiable 
        app.get("/riders/available", async (req, res) => {
            const { district } = req.query;

            try {
                const riders = await ridersCollection.find({ district }).toArray();
                res.send(riders);
            } catch (err) {
                res.status(500).send({ message: "Failed to load riders" });
            }
        });

        // rider active 
        app.get("/riders/active", async (req, res) => {
            const result = await ridersCollection.find({ status: "active" }).toArray();
            res.send(result);
        });

        // riders percers with riders email in db 
        app.get('/riders/parcels', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).status({ message: 'Rider email is required' })
                }

                const query = {
                    assigned_rider_email: email,
                    delivery_status: { $in: ['rider_assigned', 'in_transit'] }
                }
                const option = {
                    sort: { creation_date: - 1 }
                }
                const result = await allParcelsCollection.find(query, option).toArray();
                res.send(result)
            } catch (error) {
                res.status(500).send({ message: 'Failed to get raider parcel' })
            }

        })

        // riders completed percers with riders email in db 
        app.get('/riders/complete-deliveries', verifyFBToken, verifyRider, async (req, res) => {
            try {
                const email = req.query.email;
                if (!email) {
                    return res.status(400).status({ message: 'Rider email is required' })
                }

                const query = {
                    assigned_rider_email: email,
                    delivery_status: { $in: ['delivered', 'service_center_delivered'] }
                }
                const option = {
                    sort: { creation_date: - 1 }
                }
                const result = await allParcelsCollection.find(query, option).toArray();
                res.send(result)
            } catch (error) {
                res.status(500).send({ message: 'Failed to get raider parcel' })
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
                        $set: { role: 'rider' }
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

        // rider assign status 
        app.patch('/riders/asignStatus/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const result = await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { work_status: 'busy' } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to update rider status.' });
            }
        });

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

const express = require('express');
const redis = require('redis');
const kue = require('kue');
const { promisify } = require('util');

const app = express();
const port = 1245;

const client = redis.createClient();
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);

const queue = kue.createQueue();

const INITIAL_SEATS = 50;
const SEAT_KEY = 'available_seats';

let reservationEnabled = true;

setAsync(SEAT_KEY, INITIAL_SEATS);

// Middleware to set response format to JSON
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

app.get('/available_seats', async (req, res) => {
  try {
    const numberOfAvailableSeats = await getAsync(SEAT_KEY);
    res.json({ numberOfAvailableSeats });
  } catch (error) {
    res.status(500).json({ status: 'Error fetching available seats' });
  }
});

app.get('/reserve_seat', async (req, res) => {
  if (!reservationEnabled) {
    return res.json({ status: 'Reservations are blocked' });
  }

  const job = queue.create('reserve_seat').save(err => {
    if (err) {
      return res.json({ status: 'Reservation failed' });
    }
    res.json({ status: 'Reservation in process' });
  });
});

app.get('/process', async (req, res) => {
  res.json({ status: 'Queue processing' });

  queue.process('reserve_seat', async (job, done) => {
    try {
      const currentSeats = parseInt(await getAsync(SEAT_KEY), 10);
      if (currentSeats > 0) {
        await setAsync(SEAT_KEY, currentSeats - 1);
        console.log(`Seat reservation job ${job.id} completed`);
        if (currentSeats - 1 === 0) {
          reservationEnabled = false;
        }
        done();
      } else {
        done(new Error('Not enough seats available'));
      }
    } catch (error) {
      console.log(`Seat reservation job ${job.id} failed: ${error.message}`);
      done(error);
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


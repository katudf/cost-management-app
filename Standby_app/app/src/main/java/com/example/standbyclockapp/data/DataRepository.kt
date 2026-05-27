package com.example.standbyclockapp.data

import android.content.Context
import android.location.Geocoder
import android.util.Xml
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class NewsItem(
  val title: String,
  val link: String,
  val pubDate: String,
  val description: String
)

data class HourlyForecast(
  val time: String,
  val temperature: Double,
  val weatherCode: Int,
  val precipitationProbability: Int
)

data class DailyForecast(
  val date: String,
  val maxTemp: Double,
  val minTemp: Double,
  val weatherCode: Int
)

data class WeatherData(
  val temperature: Double,
  val weatherCode: Int,
  val location: String = "東京",
  val precipitationProbability: Int = 0,
  val hourlyForecasts: List<HourlyForecast> = emptyList(),
  val dailyForecasts: List<DailyForecast> = emptyList()
)

interface DataRepository {
  suspend fun fetchNews(): List<NewsItem>
  suspend fun fetchWeather(latitude: Double, longitude: Double): WeatherData
}

class DefaultDataRepository(private val context: Context) : DataRepository {

  override suspend fun fetchNews(): List<NewsItem> = withContext(Dispatchers.IO) {
    val items = mutableListOf<NewsItem>()
    var connection: HttpURLConnection? = null
    try {
      val url = URL("https://www3.nhk.or.jp/rss/news/cat0.xml")
      connection = url.openConnection() as HttpURLConnection
      connection.requestMethod = "GET"
      connection.connectTimeout = 10000
      connection.readTimeout = 10000
      connection.connect()

      if (connection.responseCode == HttpURLConnection.HTTP_OK) {
        val inputStream = connection.inputStream
        val parser = Xml.newPullParser()
        parser.setInput(inputStream, "UTF-8")

        var eventType = parser.eventType
        var inItem = false
        var title = ""
        var link = ""
        var pubDate = ""
        var description = ""
        var currentTag = ""

        while (eventType != XmlPullParser.END_DOCUMENT) {
          val tagName = parser.name
          when (eventType) {
            XmlPullParser.START_TAG -> {
              if (tagName == "item") {
                inItem = true
                title = ""
                link = ""
                pubDate = ""
                description = ""
              }
              currentTag = tagName ?: ""
            }
            XmlPullParser.TEXT -> {
              if (inItem) {
                val text = parser.text?.trim() ?: ""
                if (text.isNotEmpty()) {
                  when (currentTag) {
                    "title" -> title += text
                    "link" -> link += text
                    "pubDate" -> pubDate += text
                    "description" -> description += text
                  }
                }
              }
            }
            XmlPullParser.END_TAG -> {
              if (tagName == "item") {
                inItem = false
                if (title.isNotEmpty()) {
                  items.add(NewsItem(title, link, pubDate, description))
                }
              }
              currentTag = ""
            }
          }
          eventType = parser.next()
        }
      } else {
        throw Exception("HTTP error code: ${connection.responseCode}")
      }
    } finally {
      connection?.disconnect()
    }
    items
  }

  override suspend fun fetchWeather(latitude: Double, longitude: Double): WeatherData = withContext(Dispatchers.IO) {
    var connection: HttpURLConnection? = null
    try {
      val url = URL("https://api.open-meteo.com/v1/forecast?latitude=$latitude&longitude=$longitude&current_weather=true&hourly=temperature_2m,precipitation_probability,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia/Tokyo")
      connection = url.openConnection() as HttpURLConnection
      connection.requestMethod = "GET"
      connection.connectTimeout = 10000
      connection.readTimeout = 10000
      connection.connect()

      if (connection.responseCode == HttpURLConnection.HTTP_OK) {
        val reader = BufferedReader(InputStreamReader(connection.inputStream))
        val response = StringBuilder()
        var line: String?
        while (reader.readLine().also { line = it } != null) {
          response.append(line)
        }
        reader.close()

        val jsonObject = JSONObject(response.toString())
        val currentWeather = jsonObject.getJSONObject("current_weather")
        val temperature = currentWeather.getDouble("temperature")
        val weatherCode = currentWeather.getInt("weathercode")
        val currentTimeStr = currentWeather.getString("time")

        var currentPrecipitationProbability = 0
        val hourlyForecasts = mutableListOf<HourlyForecast>()

        val hourly = jsonObject.optJSONObject("hourly")
        if (hourly != null) {
          val hourlyTimes = hourly.optJSONArray("time")
          val hourlyTemps = hourly.optJSONArray("temperature_2m")
          val hourlyProbabilities = hourly.optJSONArray("precipitation_probability")
          val hourlyCodes = hourly.optJSONArray("weathercode")

          if (hourlyTimes != null && hourlyTemps != null && hourlyProbabilities != null && hourlyCodes != null) {
            var currentIndex = -1
            val targetPrefix = if (currentTimeStr.length >= 13) currentTimeStr.substring(0, 13) else currentTimeStr
            for (k in 0 until hourlyTimes.length()) {
              val hourlyTime = hourlyTimes.optString(k)
              val hourlyPrefix = if (hourlyTime.length >= 13) hourlyTime.substring(0, 13) else hourlyTime
              if (hourlyPrefix == targetPrefix) {
                currentIndex = k
                break
              }
            }

            if (currentIndex != -1) {
              currentPrecipitationProbability = hourlyProbabilities.optInt(currentIndex, 0)

              for (offset in 1..3) {
                val targetIndex = currentIndex + offset
                if (targetIndex < hourlyTimes.length()) {
                  val rawTime = hourlyTimes.optString(targetIndex)
                  val displayTime = try {
                    val parts = rawTime.split("T")
                    if (parts.size == 2) {
                      parts[1]
                    } else {
                      rawTime
                    }
                  } catch (e: Exception) {
                    rawTime
                  }

                  hourlyForecasts.add(
                    HourlyForecast(
                      time = displayTime,
                      temperature = hourlyTemps.optDouble(targetIndex, 0.0),
                      weatherCode = hourlyCodes.optInt(targetIndex, 0),
                      precipitationProbability = hourlyProbabilities.optInt(targetIndex, 0)
                    )
                  )
                }
              }
            }
          }
        }

        val dailyForecasts = mutableListOf<DailyForecast>()
        val daily = jsonObject.optJSONObject("daily")
        if (daily != null) {
          val dailyTimes = daily.optJSONArray("time")
          val dailyCodes = daily.optJSONArray("weathercode")
          val dailyMaxTemps = daily.optJSONArray("temperature_2m_max")
          val dailyMinTemps = daily.optJSONArray("temperature_2m_min")

          if (dailyTimes != null && dailyCodes != null && dailyMaxTemps != null && dailyMinTemps != null) {
            val inputDateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val displayDateFormat = SimpleDateFormat("E", Locale.JAPAN)

            val limit = minOf(dailyTimes.length(), 5)
            for (k in 0 until limit) {
              val dateStr = dailyTimes.optString(k)
              val displayDate = try {
                val parsedDate = inputDateFormat.parse(dateStr)
                if (parsedDate != null) displayDateFormat.format(parsedDate) else dateStr
              } catch (e: Exception) {
                dateStr
              }

              dailyForecasts.add(
                DailyForecast(
                  date = displayDate,
                  maxTemp = dailyMaxTemps.optDouble(k, 0.0),
                  minTemp = dailyMinTemps.optDouble(k, 0.0),
                  weatherCode = dailyCodes.optInt(k, 0)
                )
              )
            }
          }
        }

        val cityName = getCityName(context, latitude, longitude)
        WeatherData(
          temperature = temperature,
          weatherCode = weatherCode,
          location = cityName,
          precipitationProbability = currentPrecipitationProbability,
          hourlyForecasts = hourlyForecasts,
          dailyForecasts = dailyForecasts
        )
      } else {
        throw Exception("HTTP error code: ${connection.responseCode}")
      }
    } finally {
      connection?.disconnect()
    }
  }

  private fun getCityName(context: Context, latitude: Double, longitude: Double): String {
    return try {
      val geocoder = Geocoder(context, Locale.JAPAN)
      if (latitude == 35.6895 && longitude == 139.6917) {
        return "東京"
      }
      val addresses = geocoder.getFromLocation(latitude, longitude, 1)
      if (!addresses.isNullOrEmpty()) {
        val address = addresses[0]
        address.locality ?: address.adminArea ?: "現在地"
      } else {
        "現在地"
      }
    } catch (e: Exception) {
      e.printStackTrace()
      "現在地"
    }
  }
}
